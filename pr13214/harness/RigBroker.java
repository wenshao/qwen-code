package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.CompletableFuture;
import javax.sql.DataSource;

/**
 * PR 13214 rig: one real Broker process. Production RuntimeBrokerService over
 * the production JDBC repositories (MySQL), the production HTTP face, the
 * production non-durable LocalProcessRuntimeProvisioner spawning the bundled
 * worker (node dist/cli.js managed-runtime-worker), and the production HTTP
 * transport routed through an in-process counting proxy (FaultProxy from the
 * module's test-jar) so worker calls can be counted or dropped.
 *
 * stdin commands (one JSON per line): {"op":"counts"}, {"op":"drop","name":"execute"},
 * {"op":"workers"}. Replies on stdout.
 */
public final class RigBroker {
    private RigBroker() {
    }

    public static void main(String[] args) throws Exception {
        PrintStream out = new PrintStream(System.out, true, StandardCharsets.UTF_8);
        System.setOut(System.err);
        JSONObject config = JSON.parseObject(Files.readString(Path.of(args[0])));
        DataSource dataSource = new DriverManagerDataSource(config.getString("jdbcUrl"),
                config.getString("user"), config.getString("password"));
        if (config.getBooleanValue("initSchema")) {
            JdbcRuntimeBrokerSchema.initialize(dataSource);
        }
        FaultProxy proxy = new FaultProxy();
        HttpClient client = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(Duration.ofSeconds(5))
                .proxy(ProxySelector.of(new InetSocketAddress(
                        InetAddress.getLoopbackAddress(), proxy.port())))
                .build();
        HttpRuntimeTransport runtime = new HttpRuntimeTransport(client,
                Duration.ofMillis(config.getLongValue("requestTimeoutMillis", 10_000)));
        // durable=true: the production durable store (host identity injected on macOS, as the fault gates do)
        LocalProcessRuntimeProvisioner provisioner = config.getBooleanValue("durable")
                ? new LocalProcessRuntimeProvisioner(
                        List.of(config.getString("node"), config.getString("cli"), "managed-runtime-worker"),
                        Path.of(config.getString("stateDir")), runtime, null,
                        new LocalRuntimeStore(Path.of(config.getString("stateDir")).resolve("durable"),
                                "Linux".equals(System.getProperty("os.name")) ? LocalRuntimeStore.HostIdentity.linux()
                                        : new LocalRuntimeStore.HostIdentity("a".repeat(32), config.getString("bootId") == null ? "11111111-1111-1111-1111-111111111111" : config.getString("bootId"), "pid:[1]", "time:[1]")), config.getBooleanValue("trustedReboot"))
                : new LocalProcessRuntimeProvisioner(
                        List.of(config.getString("node"), config.getString("cli"), "managed-runtime-worker"),
                        Path.of(config.getString("stateDir")), runtime);
        RuntimeProvisioner effective = config.getString("records") == null ? provisioner
                : new RecoverableProcessProvisioner(provisioner, runtime, Path.of(config.getString("records")));
        Map<String, RuntimeScope> scopes = new TreeMap<>();
        JSONObject scopeConfig = config.getJSONObject("scopes");
        for (String harness : scopeConfig.keySet()) {
            JSONObject scope = scopeConfig.getJSONObject(harness);
            scopes.put(harness, new RuntimeScope(scope.getString("tenantId"),
                    scope.getString("workspaceId"), scope.getString("workspaceGeneration"),
                    scope.getString("canonicalCwd"), scope.getString("capabilityDigest"),
                    scope.getString("isolationClass")));
        }
        JdbcRuntimeBindingRepository bindings = new JdbcRuntimeBindingRepository(dataSource,
                AesGcmSecretProtector.fromBase64("rig", config.getString("secretKey")));
        JdbcRuntimeSessionRepository sessions = new JdbcRuntimeSessionRepository(dataSource);
        JdbcToolExecutionRepository executions = new JdbcToolExecutionRepository(dataSource);
        RuntimeBrokerService service = new RuntimeBrokerService(
                harness -> {
                    RuntimeScope scope = scopes.get(harness);
                    return scope == null
                            ? CompletableFuture.failedFuture(new IllegalArgumentException("unknown harness"))
                            : CompletableFuture.completedFuture(scope);
                },
                effective, new FaultGateTransport(runtime), bindings, sessions, executions,
                config.getString("ownerId"),
                Duration.ofMillis(config.getLongValue("operationLeaseMillis")),
                Duration.ofMillis(config.getLongValue("dispatchLeaseMillis")));
        RuntimeBrokerHttpServer server = new RuntimeBrokerHttpServer(
                new InetSocketAddress(InetAddress.getLoopbackAddress(), config.getIntValue("httpPort")),
                config.getString("token"), service);
        server.start();
        Map<String, Object> ready = new LinkedHashMap<>();
        ready.put("ready", true);
        ready.put("pid", ProcessHandle.current().pid());
        ready.put("baseUri", server.getBaseUri().toString());
        out.println(JSON.toJSONString(ready));
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        while ((line = input.readLine()) != null) {
            JSONObject command = JSON.parseObject(line);
            Map<String, Object> reply = new LinkedHashMap<>();
            reply.put("op", command.getString("op"));
            switch (command.getString("op")) {
                case "counts" -> {
                    Map<String, Long> counts = new TreeMap<>();
                    for (FaultProxy.Exchange exchange : proxy.exchanges()) {
                        counts.merge(exchange.operation(), 1L, Long::sum);
                    }
                    reply.put("counts", counts);
                }
                case "drop" -> {
                    proxy.schedule(command.getString("name"), FaultProxy.Action.DROP);
                    reply.put("scheduled", true);
                }
                case "workers" -> reply.put("workers", ProcessHandle.current().children()
                        .map(ProcessHandle::pid).toList());
                case "close" -> {
                    server.close();
                    reply.put("closed", true);
                }
                default -> reply.put("error", "unknown op");
            }
            out.println(JSON.toJSONString(reply));
        }
        // stdin closed: keep serving until killed (SIGTERM runs JVM shutdown hooks)
        Thread.currentThread().join();
    }
}
