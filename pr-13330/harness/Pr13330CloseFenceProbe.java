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
import java.util.Set;
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
 * PR #13330 verification probe (not part of the PR). Boots the real
 * ManagedAgentServerApplication on a file-backed H2 database with the embedded
 * Runtime Broker (local-process provisioner, session isolation, the bundled
 * CLI as the worker entry), drives
 * close / archive / delete of unbound Sessions through the public HTTP API,
 * then calls the broker's RuntimeWarmer.warm(sessionId) exactly as
 * HarnessCoordinator.warmRuntime does for a dispatched Turn. Repeats the warm
 * calls after a full application restart on the same database.
 */
class Pr13330CloseFenceProbe {
    private static final String TENANT = "probe-tenant";
    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient http = HttpClient.newHttpClient();
    @TempDir
    Path temporary;
    private int port;

    @Test
    void closeArchiveDeleteThenWarm() throws Exception {
        // Same process: lifecycle through the public API, then warm.
        String sameDb = "jdbc:h2:file:" + temporary.resolve("same-db") + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE";
        try (var spring = start(sameDb, "same")) {
            Map<String, String> sessions = lifecycle(spring);
            EmbeddedRuntimeBroker broker = spring.getBean(EmbeddedRuntimeBroker.class);
            @SuppressWarnings("unchecked")
            Set<String> retired = (Set<String>) field(broker, "retired");
            JdbcTemplate jdbc = spring.getBean(JdbcTemplate.class);
            for (var entry : sessions.entrySet()) {
                System.out.println("PROBE phase=same-process session=" + entry.getKey()
                        + " row_status=" + status(jdbc, entry.getValue())
                        + " in_process_retired=" + retired.contains(entry.getValue()));
            }
            for (var entry : sessions.entrySet()) {
                warm("same-process", entry.getKey(), entry.getValue(), broker, jdbc);
            }
        }
        // Restart: lifecycle in one process, warm in a fresh one on the same
        // database (nothing was warmed before the restart).
        String restartDb = "jdbc:h2:file:" + temporary.resolve("restart-db") + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE";
        Map<String, String> sessions;
        try (var spring = start(restartDb, "restart-1")) {
            sessions = lifecycle(spring);
        }
        try (var spring = start(restartDb, "restart-2")) {
            JdbcTemplate jdbc = spring.getBean(JdbcTemplate.class);
            EmbeddedRuntimeBroker broker = spring.getBean(EmbeddedRuntimeBroker.class);
            for (var entry : sessions.entrySet()) {
                warm("after-restart", entry.getKey(), entry.getValue(), broker, jdbc);
            }
        }
    }

    private Map<String, String> lifecycle(ServletWebServerApplicationContext spring) throws Exception {
        Map<String, String> sessions = new LinkedHashMap<>();
        for (String name : List.of("active", "closed", "archived", "deleted")) {
            sessions.put(name, request("POST", "/v1/agents/sessions",
                    Map.of("agent_id", "qwen-code"), "create-" + name, 202).path("id").asText());
        }
        awaitOperation(sessions.get("closed"), request("POST", "/v1/agents/sessions/" + sessions.get("closed")
                + "/close", null, "close-closed", 202).path("id").asText());
        awaitOperation(sessions.get("archived"), request("POST", "/v1/agents/sessions/" + sessions.get("archived")
                + "/close", null, "close-archived", 202).path("id").asText());
        request("POST", "/v1/agents/sessions/" + sessions.get("archived") + "/archive", null, "archive-archived", 202);
        awaitOperation(sessions.get("deleted"), request("DELETE", "/v1/agents/sessions/" + sessions.get("deleted"),
                null, "delete-deleted", 202).path("id").asText());
        return sessions;
    }

    private void warm(String phase, String name, String session, EmbeddedRuntimeBroker broker, JdbcTemplate jdbc) {
        long bindingsBefore = bindings(jdbc, session);
        String outcome;
        try {
            broker.warm(session).toCompletableFuture().get(20, TimeUnit.SECONDS);
            outcome = "WARMED";
        } catch (Exception error) {
            Throwable cause = error;
            while ((cause instanceof CompletionException || cause instanceof java.util.concurrent.ExecutionException)
                    && cause.getCause() != null) {
                cause = cause.getCause();
            }
            outcome = cause instanceof RuntimeBrokerException broker409
                    ? "REFUSED code=" + broker409.getCode()
                    : "FAILED " + cause.getClass().getSimpleName() + ": " + cause.getMessage();
        }
        System.out.println("PROBE phase=" + phase + " session=" + name + " row_status=" + status(jdbc, session)
                + " warm=" + outcome + " runtime_bindings=" + bindingsBefore + "->" + bindings(jdbc, session)
                + " binding_state=" + jdbc.queryForList("SELECT binding_state FROM qwen_runtime_binding"
                        + " WHERE isolation_key = ?", String.class, session));
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
            JsonNode state = request("GET", "/v1/agents/sessions/" + session + "/operations/" + operation, null, null, 200);
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
                "--qwen.managed-agent.runtime-broker.token=probe-broker-token",
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
                .timeout(Duration.ofSeconds(10)).header("X-Qwen-Tenant-Id", TENANT)
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

    private static Object field(Object target, String name) throws Exception {
        var field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(target);
    }
}
