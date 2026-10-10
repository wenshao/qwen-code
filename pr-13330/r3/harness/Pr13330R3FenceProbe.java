package com.alibaba.qwen.code.managedagent;

import com.alibaba.qwen.code.managedagent.api.AuthenticatedTenantActor;
import com.alibaba.qwen.code.managedagent.service.EmbeddedRuntimeBroker;
import com.alibaba.qwen.code.runtimebroker.RuntimeBrokerException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.security.Principal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.core.Ordered;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * PR #13330 round-3 verification probe (not part of the PR). Boots the real
 * ManagedAgentServerApplication on a file-backed H2 database with the
 * embedded Runtime Broker (local-process provisioner, session isolation, the
 * bundled CLI as the worker), moves unbound Sessions through the public
 * lifecycle API, then drives every Broker route that can start Runtime work:
 * the Java warm HarnessCoordinator uses, the HTTP warm route, and the HTTP
 * tool-session acquire route the Harness uses. Repeats after a restart on
 * the same database. A second test drives release over HTTP.
 */
class Pr13330R3FenceProbe {
    private static final String TENANT = "probe-tenant";
    private static final String TOKEN = "probe-broker-token";
    private static final List<String> STATUSES = List.of("active", "closing", "closed", "archived", "deleted");
    private static final List<String> ROUTES = List.of("warm_java", "warm_http", "acquire_http");
    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient http = HttpClient.newHttpClient();
    @TempDir
    Path temporary;
    private int port;

    @Test
    void admissionRoutesAcrossTheFence() throws Exception {
        String sameDb = "jdbc:h2:file:" + temporary.resolve("same-db") + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE";
        try (var spring = start(sameDb, "same")) {
            Map<String, String> sessions = lifecycle(spring, "s");
            drive("same-process", spring, sessions);
        }
        String restartDb = "jdbc:h2:file:" + temporary.resolve("restart-db") + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE";
        Map<String, String> sessions;
        try (var spring = start(restartDb, "restart-1")) {
            sessions = lifecycle(spring, "r");
        }
        try (var spring = start(restartDb, "restart-2")) {
            drive("after-restart", spring, sessions);
        }
    }

    /**
     * Release over HTTP, the way the Harness provider releases: acquire a
     * Runtime Session while ACTIVE, then release it with the row CLOSING or
     * CLOSED, in the same process and after a restart.
     */
    @Test
    void releaseAcrossTheFence() throws Exception {
        String sameDb = "jdbc:h2:file:" + temporary.resolve("release-same") + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE";
        try (var spring = start(sameDb, "release-same")) {
            JdbcTemplate jdbc = spring.getBean(JdbcTemplate.class);
            URI broker = spring.getBean(EmbeddedRuntimeBroker.class).getBaseUri();
            Map<String, String[]> held = new LinkedHashMap<>();
            for (String name : List.of("closing", "closed")) {
                String session = create("rel-s-" + name);
                held.put(name, new String[] {session, acquireForRelease(broker, session, jdbc)});
            }
            jdbc.update("UPDATE managed_agent_session SET status = 'CLOSING' WHERE session_id = ?",
                    held.get("closing")[0]);
            awaitOperation(held.get("closed")[0], request("POST", "/v1/agents/sessions/" + held.get("closed")[0]
                    + "/close", null, "close-rel-s-closed", 202).path("id").asText());
            for (var entry : held.entrySet()) {
                release("same-process", entry.getKey(), broker, entry.getValue()[0], entry.getValue()[1], jdbc);
            }
        }
        String restartDb = "jdbc:h2:file:" + temporary.resolve("release-restart") + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE";
        Map<String, String[]> held = new LinkedHashMap<>();
        try (var spring = start(restartDb, "release-r1")) {
            JdbcTemplate jdbc = spring.getBean(JdbcTemplate.class);
            URI broker = spring.getBean(EmbeddedRuntimeBroker.class).getBaseUri();
            for (String name : List.of("active", "closing", "closed")) {
                String session = create("rel-r-" + name);
                held.put(name, new String[] {session, acquireForRelease(broker, session, jdbc)});
            }
        }
        try (var spring = start(restartDb, "release-r2")) {
            JdbcTemplate jdbc = spring.getBean(JdbcTemplate.class);
            URI broker = spring.getBean(EmbeddedRuntimeBroker.class).getBaseUri();
            jdbc.update("UPDATE managed_agent_session SET status = 'CLOSING' WHERE session_id = ?",
                    held.get("closing")[0]);
            awaitOperation(held.get("closed")[0], request("POST", "/v1/agents/sessions/" + held.get("closed")[0]
                    + "/close", null, "close-rel-r-closed", 202).path("id").asText());
            for (var entry : held.entrySet()) {
                release("after-restart", entry.getKey(), broker, entry.getValue()[0], entry.getValue()[1], jdbc);
            }
        }
    }

    private void drive(String phase, ServletWebServerApplicationContext spring, Map<String, String> sessions)
            throws Exception {
        JdbcTemplate jdbc = spring.getBean(JdbcTemplate.class);
        EmbeddedRuntimeBroker broker = spring.getBean(EmbeddedRuntimeBroker.class);
        URI base = broker.getBaseUri();
        for (String status : STATUSES) {
            for (String route : ROUTES) {
                String session = sessions.get(status + "/" + route);
                long before = bindings(jdbc, session);
                long workersBefore = workers();
                String outcome = switch (route) {
                    case "warm_java" -> warmJava(broker, session);
                    case "warm_http" -> brokerCall(base, "/runtimes:warm", Map.of("protocolVersion", 1,
                            "requestId", UUID.randomUUID().toString(), "harnessSessionId", session));
                    default -> brokerCall(base, "/tool-sessions:acquire", Map.of("protocolVersion", 1,
                            "requestId", UUID.randomUUID().toString(), "harnessSessionId", session,
                            "runtimeSessionId", "rt-" + UUID.randomUUID(), "turnKind", "bootstrap"));
                };
                System.out.println("PROBE fence phase=" + phase + " status=" + status + " route=" + route
                        + " row_status=" + status(jdbc, session) + " outcome=" + outcome
                        + " runtime_bindings=" + before + "->" + bindings(jdbc, session)
                        + " binding_state=" + jdbc.queryForList("SELECT binding_state FROM qwen_runtime_binding"
                                + " WHERE isolation_key = ?", String.class, session)
                        + " worker_processes=" + workersBefore + "->" + workers());
            }
        }
    }

    private String warmJava(EmbeddedRuntimeBroker broker, String session) {
        try {
            broker.warm(session).toCompletableFuture().get(60, TimeUnit.SECONDS);
            return "OK";
        } catch (Exception error) {
            Throwable cause = error;
            while ((cause instanceof CompletionException || cause instanceof java.util.concurrent.ExecutionException)
                    && cause.getCause() != null) {
                cause = cause.getCause();
            }
            return cause instanceof RuntimeBrokerException refused
                    ? "REFUSED " + refused.getStatusCode() + " " + refused.getCode() + " retryable="
                            + refused.isRetryable()
                    : "FAILED " + cause.getClass().getSimpleName() + ": " + cause.getMessage();
        }
    }

    private String brokerCall(URI base, String route, Map<String, Object> body) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(base.resolve("/internal/runtime-broker/v1" + route))
                .timeout(Duration.ofSeconds(90)).header("Authorization", "Bearer " + TOKEN)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
        var response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() == 200) {
            return "OK 200";
        }
        JsonNode error = json.readTree(response.body());
        return "REFUSED " + response.statusCode() + " " + error.path("code").asText()
                + " retryable=" + error.path("retryable").asText();
    }

    private String acquireForRelease(URI base, String session, JdbcTemplate jdbc) throws Exception {
        String runtime = "rt-" + UUID.randomUUID();
        String outcome = brokerCall(base, "/tool-sessions:acquire", Map.of("protocolVersion", 1,
                "requestId", UUID.randomUUID().toString(), "harnessSessionId", session,
                "runtimeSessionId", runtime, "turnKind", "bootstrap"));
        System.out.println("PROBE release-setup acquire session=" + session.substring(0, 8) + " outcome=" + outcome
                + " runtime_session_state=" + runtimeState(jdbc, runtime));
        return runtime;
    }

    private void release(String phase, String name, URI base, String session, String runtime, JdbcTemplate jdbc)
            throws Exception {
        String before = runtimeState(jdbc, runtime);
        String outcome = brokerCall(base, "/tool-sessions/" + runtime + ":release", Map.of("protocolVersion", 1,
                "requestId", UUID.randomUUID().toString(), "harnessSessionId", session));
        System.out.println("PROBE release phase=" + phase + " session=" + name + " row_status=" + status(jdbc, session)
                + " release=" + outcome + " runtime_session_state=" + before + "->" + runtimeState(jdbc, runtime)
                + " binding_state=" + jdbc.queryForList("SELECT binding_state FROM qwen_runtime_binding"
                        + " WHERE isolation_key = ?", String.class, session));
    }

    private static String runtimeState(JdbcTemplate jdbc, String runtime) {
        List<String> rows = jdbc.queryForList("SELECT session_state FROM qwen_runtime_session"
                + " WHERE runtime_session_id = ?", String.class, runtime);
        return rows.isEmpty() ? "<no row>" : String.join(",", rows);
    }

    private static long workers() {
        String entry = System.getProperty("qwen.cli.entry");
        return ProcessHandle.allProcesses().filter(process -> process.info().commandLine()
                .map(line -> line.contains(entry)).orElse(false)).count();
    }

    private String create(String key) throws Exception {
        return request("POST", "/v1/agents/sessions", Map.of("agent_id", "qwen-code"), key, 202).path("id").asText();
    }

    private Map<String, String> lifecycle(ServletWebServerApplicationContext spring, String prefix) throws Exception {
        JdbcTemplate jdbc = spring.getBean(JdbcTemplate.class);
        Map<String, String> sessions = new LinkedHashMap<>();
        for (String status : STATUSES) {
            for (String route : ROUTES) {
                String key = prefix + "-" + status + "-" + route;
                String id = create(key);
                sessions.put(status + "/" + route, id);
                switch (status) {
                    case "closing" -> jdbc.update(
                            "UPDATE managed_agent_session SET status = 'CLOSING' WHERE session_id = ?", id);
                    case "closed" -> awaitOperation(id, request("POST", "/v1/agents/sessions/" + id + "/close",
                            null, "close-" + key, 202).path("id").asText());
                    case "archived" -> {
                        awaitOperation(id, request("POST", "/v1/agents/sessions/" + id + "/close", null,
                                "close-" + key, 202).path("id").asText());
                        request("POST", "/v1/agents/sessions/" + id + "/archive", null, "archive-" + key, 202);
                    }
                    case "deleted" -> awaitOperation(id, request("DELETE", "/v1/agents/sessions/" + id, null,
                            "delete-" + key, 202).path("id").asText());
                    default -> { }
                }
            }
        }
        for (var entry : sessions.entrySet()) {
            System.out.println("PROBE lifecycle " + entry.getKey() + " row_status=" + status(jdbc, entry.getValue()));
        }
        return sessions;
    }

    private static long bindings(JdbcTemplate jdbc, String session) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM qwen_runtime_binding WHERE isolation_key = ?",
                Long.class, session);
    }

    private static String status(JdbcTemplate jdbc, String session) {
        List<String> rows = jdbc.queryForList("SELECT status FROM managed_agent_session WHERE session_id = ?",
                String.class, session);
        return rows.isEmpty() ? "<no row>" : rows.getFirst();
    }

    private void awaitOperation(String session, String operation) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        while (System.nanoTime() < deadline) {
            JsonNode state = request("GET", "/v1/agents/sessions/" + session + "/operations/" + operation, null,
                    null, 200);
            if ("completed".equals(state.path("status").asText())) {
                return;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("operation did not complete: " + operation);
    }

    private ServletWebServerApplicationContext start(String db, String state) throws Exception {
        try (ServerSocket socket = new ServerSocket(0)) {
            port = socket.getLocalPort();
        }
        List<String> arguments = new ArrayList<>(List.of("--server.address=127.0.0.1", "--server.port=" + port,
                "--spring.datasource.url=" + db, "--spring.datasource.driver-class-name=org.h2.Driver",
                "--spring.datasource.username=sa", "--spring.datasource.password=",
                "--qwen.managed-agent.harness.enabled=false",
                "--qwen.managed-agent.harness.capability-digest=sha256:" + "a".repeat(64),
                "--qwen.managed-agent.runtime-broker.enabled=true",
                "--qwen.managed-agent.runtime-broker.port=0",
                "--qwen.managed-agent.runtime-broker.token=" + TOKEN,
                "--qwen.managed-agent.runtime-broker.provisioner=local-process",
                "--qwen.managed-agent.runtime-broker.isolation-class=session",
                "--qwen.managed-agent.runtime-broker.state-directory="
                        + java.nio.file.Files.createDirectories(temporary.resolve("broker-" + state)),
                "--qwen.managed-agent.runtime-broker.node-executable=" + System.getProperty("node.executable"),
                "--qwen.managed-agent.runtime-broker.worker-entry=" + System.getProperty("qwen.cli.entry"),
                "--qwen.managed-agent.runtime-broker.cli-entry=" + System.getProperty("qwen.cli.entry"),
                "--qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false",
                "--qwen.managed-agent.runtime-broker.durable-local-process=false",
                "--qwen.managed-agent.runtime-broker.workspace-cwd="
                        + java.nio.file.Files.createDirectories(temporary.resolve("workspace")).toRealPath(),
                "--qwen.managed-agent.runtime-broker.credential-key-id=probe",
                "--qwen.managed-agent.runtime-broker.credential-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="));
        return (ServletWebServerApplicationContext) new SpringApplicationBuilder(ManagedAgentServerApplication.class)
                .initializers(context -> context.getBeanFactory().registerSingleton("probeAuthentication",
                        authentication()))
                .run(arguments.toArray(String[]::new));
    }

    private static FilterRegistrationBean<Filter> authentication() {
        FilterRegistrationBean<Filter> filter = new FilterRegistrationBean<>((request, response, chain) ->
                chain.doFilter(new HttpServletRequestWrapper((HttpServletRequest) request) {
                    @Override
                    public Principal getUserPrincipal() {
                        return new AuthenticatedTenantActor() {
                            public String tenantId() { return TENANT; }
                            public String actorId() { return "actor"; }
                            public String getName() { return "actor"; }
                        };
                    }
                }, response));
        filter.setOrder(Ordered.HIGHEST_PRECEDENCE);
        filter.addUrlPatterns("/v1/agents/*");
        return filter;
    }

    private JsonNode request(String method, String path, Object body, String key, int expected) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(30)).header("X-Qwen-Tenant-Id", TENANT)
                .header("Accept", "application/json").header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        if (key != null) {
            request.header("Idempotency-Key", key);
        }
        var response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != expected) {
            throw new AssertionError(method + " " + path + " -> " + response.statusCode() + ": " + response.body());
        }
        return response.body().isEmpty() ? json.createObjectNode() : json.readTree(response.body());
    }
}
