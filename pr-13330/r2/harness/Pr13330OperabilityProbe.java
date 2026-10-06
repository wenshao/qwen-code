package com.alibaba.qwen.code.managedagent;

import com.alibaba.qwen.code.managedagent.api.AuthenticatedTenantActor;
import com.alibaba.qwen.code.managedagent.store.ManagedAgentStore;
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
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.core.Ordered;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * PR #13330 verification probe (not part of the PR): operator-visible behaviour
 * of the real ManagedAgentServerApplication (H2) for the startup validation,
 * rename cause chaining and materializer backoff items.
 */
@ExtendWith(OutputCaptureExtension.class)
class Pr13330OperabilityProbe {
    private static final String TENANT = "probe-tenant";
    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient http = HttpClient.newHttpClient();
    @TempDir
    Path temporary;
    private int port;

    @Test
    void startupValidation(CapturedOutput output) throws Exception {
        int dead = freePort();
        String digest = "sha256:" + "a".repeat(64);
        List<String> harness = List.of("--qwen.managed-agent.harness.enabled=true",
                "--qwen.managed-agent.harness.token=probe-token",
                "--qwen.managed-agent.harness.capability-digest=" + digest);
        for (var config : List.of(
                Map.entry("schemeless_base_url", List.of("--qwen.managed-agent.harness.base-url=localhost:4170")),
                Map.entry("empty_base_url", List.of("--qwen.managed-agent.harness.base-url=")),
                Map.entry("zero_renew", List.of("--qwen.managed-agent.harness.base-url=http://127.0.0.1:" + dead,
                        "--qwen.managed-agent.dispatch.lease-renew-interval=0s")),
                Map.entry("renew_equals_lease", List.of("--qwen.managed-agent.harness.base-url=http://127.0.0.1:" + dead,
                        "--qwen.managed-agent.dispatch.lease-duration=20s",
                        "--qwen.managed-agent.dispatch.lease-renew-interval=20s")),
                Map.entry("defaults_dead_harness", List.of("--qwen.managed-agent.harness.base-url=http://127.0.0.1:" + dead)))) {
            List<String> arguments = new ArrayList<>(harness);
            arguments.addAll(config.getValue());
            int mark = output.getOut().length();
            try (var spring = start("jdbc:h2:mem:" + config.getKey() + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
                    arguments)) {
                System.out.println("PROBE startup config=" + config.getKey() + " -> STARTED");
                // First real use: create a Session (no Harness call) and rename it
                // (the rename reaches the Hosted Harness).
                String session = request("POST", "/v1/agents/sessions", Map.of("agent_id", "qwen-code"),
                        "create", null).path("id").asText();
                int before = output.getOut().length();
                JsonNode renamed = request("PATCH", "/v1/agents/sessions/" + session, Map.of("title", "Renamed"),
                        "rename", null);
                String log = output.getOut().substring(before);
                System.out.println("PROBE startup config=" + config.getKey() + " first_rename -> HTTP "
                        + renamed.path("__status").asInt() + " " + renamed.at("/error/code").asText()
                        + " | server_log_lines=" + log.lines().count()
                        + " rename_warn_logged=" + log.contains("Hosted Harness rename failed")
                        + " root_cause_logged=" + (log.contains("ConnectException") || log.contains("Connection refused")
                                || log.contains("IllegalArgumentException") || log.contains("URISyntax")));
            } catch (Exception error) {
                Throwable root = error;
                while (root.getCause() != null) {
                    root = root.getCause();
                }
                System.out.println("PROBE startup config=" + config.getKey() + " -> REFUSED TO START: "
                        + root.getClass().getSimpleName() + ": " + root.getMessage());
            }
        }
        try (var spring = start("jdbc:h2:mem:k8s;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE", List.of(
                "--qwen.managed-agent.harness.capability-digest=" + digest,
                "--qwen.managed-agent.runtime-broker.enabled=true",
                "--qwen.managed-agent.runtime-broker.port=0",
                "--qwen.managed-agent.runtime-broker.token=probe-broker-token",
                "--qwen.managed-agent.runtime-broker.provisioner=kubernetes",
                "--qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false",
                "--qwen.managed-agent.runtime-broker.workspace-cwd=" + temporary.toRealPath(),
                "--qwen.managed-agent.runtime-broker.credential-key-id=probe",
                "--qwen.managed-agent.runtime-broker.credential-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="))) {
            System.out.println("PROBE startup config=kubernetes_provisioner -> STARTED");
        } catch (Exception error) {
            Throwable root = error;
            while (root.getCause() != null) {
                root = root.getCause();
            }
            System.out.println("PROBE startup config=kubernetes_provisioner -> REFUSED TO START: "
                    + root.getMessage());
        }
    }

    @Test
    void poisonedMaterializationTargets(CapturedOutput output) throws Exception {
        try (var spring = start("jdbc:h2:mem:materializer;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
                List.of("--qwen.managed-agent.harness.enabled=false"))) {
            JdbcTemplate jdbc = spring.getBean(JdbcTemplate.class);
            ManagedAgentStore store = spring.getBean(ManagedAgentStore.class);
            var tx = new TransactionTemplate(spring.getBean(PlatformTransactionManager.class));
            // 1. One permanently poisoned Session among caught-up ones: warn rate over time.
            String single = request("POST", "/v1/agents/sessions", Map.of("agent_id", "qwen-code"), "single", null)
                    .path("id").asText();
            awaitCaughtUp(jdbc, single);
            poison(tx, store, jdbc, single);
            String marker = "Failed to materialize Managed Agent session " + single;
            int mark = output.getOut().length();
            long start = System.nanoTime();
            StringBuilder series = new StringBuilder();
            long previous = 0;
            for (int second = 1; second <= 40; second++) {
                Thread.sleep(Math.max(0, start + second * 1_000_000_000L - System.nanoTime()) / 1_000_000L);
                long total = output.getOut().substring(mark).lines().filter(line -> line.contains(marker)).count();
                series.append(second == 1 ? "" : ",").append(total - previous);
                previous = total;
            }
            System.out.println("PROBE materializer single_poisoned warns_per_second=[" + series + "] total_40s="
                    + previous);
            jdbc.update("DELETE FROM managed_agent_consumer_progress WHERE session_id = ?", single);

            // 2. 33 poisoned Sessions (more than TARGET_LIMIT=32) and one healthy Session
            //    that receives a new event afterwards: is the healthy one starved?
            List<String> poisoned = new ArrayList<>();
            for (int index = 0; index < 33; index++) {
                String id = request("POST", "/v1/agents/sessions", Map.of("agent_id", "qwen-code"), "p" + index, null)
                        .path("id").asText();
                poisoned.add(id);
            }
            String healthy = request("POST", "/v1/agents/sessions", Map.of("agent_id", "qwen-code"), "healthy", null)
                    .path("id").asText();
            for (String id : poisoned) {
                awaitCaughtUp(jdbc, id);
            }
            awaitCaughtUp(jdbc, healthy);
            int poisonMark = output.getOut().length();
            for (String id : poisoned) {
                poison(tx, store, jdbc, id);
            }
            long appended = System.nanoTime();
            store.appendPublicEventIfAbsent(TENANT, healthy, null, "session.title.updated",
                    Map.of("title", "fresh"), false, "probe-healthy-1");
            long waited = -1;
            while (System.nanoTime() - appended < 15_000_000_000L) {
                if (caughtUp(jdbc, healthy)) {
                    waited = (System.nanoTime() - appended) / 1_000_000L;
                    break;
                }
                Thread.sleep(20);
            }
            System.out.println("PROBE materializer starvation poisoned=33 healthy_event_materialized_after_ms="
                    + (waited < 0 ? "NEVER (15000 ms timeout)" : Long.toString(waited)));
            // 3. Total warn volume from the 33 poisoned Sessions, in 5 s buckets
            //    measured from the moment they were poisoned.
            StringBuilder buckets = new StringBuilder();
            long counted = 0;
            for (int bucket = 1; bucket <= 8; bucket++) {
                Thread.sleep(Math.max(0, appended + bucket * 5_000_000_000L - System.nanoTime()) / 1_000_000L);
                long total = output.getOut().substring(poisonMark).lines().filter(line -> line.contains(
                        "Failed to materialize Managed Agent session")).count();
                buckets.append(bucket == 1 ? "" : ",").append(total - counted);
                counted = total;
            }
            System.out.println("PROBE materializer poisoned=33 warns_per_5s_since_poison=[" + buckets + "]"
                    );
        }
    }

    /**
     * Round 2 (triage follow-up): does a poisoned Session's failures entry
     * outlive the Session? Close one, delete one, and catch one up outside
     * this materializer (what another server instance would do), then watch
     * selection, WARN lines and the map for 15 s.
     */
    @Test
    void poisonedThenClosedDeletedOrHealedElsewhere(CapturedOutput output) throws Exception {
        try (var spring = start("jdbc:h2:mem:failures;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
                List.of("--qwen.managed-agent.harness.enabled=false"))) {
            JdbcTemplate jdbc = spring.getBean(JdbcTemplate.class);
            ManagedAgentStore store = spring.getBean(ManagedAgentStore.class);
            var tx = new TransactionTemplate(spring.getBean(PlatformTransactionManager.class));
            Object materializer = spring.getBean(
                    com.alibaba.qwen.code.managedagent.service.MessageMaterializer.class);
            Map<String, Integer> failures;
            try {
                var field = materializer.getClass().getDeclaredField("failures");
                field.setAccessible(true);
                @SuppressWarnings("unchecked")
                Map<String, Integer> found = (Map<String, Integer>) field.get(materializer);
                failures = found;
            } catch (NoSuchFieldException absent) {
                failures = Map.of(); // base: no backoff map
            }
            Map<String, String> sessions = new java.util.LinkedHashMap<>();
            for (String name : List.of("kept", "closed", "deleted", "healed_elsewhere")) {
                sessions.put(name, request("POST", "/v1/agents/sessions", Map.of("agent_id", "qwen-code"),
                        "f-" + name, 202).path("id").asText());
            }
            for (String id : sessions.values()) {
                awaitCaughtUp(jdbc, id);
                poison(tx, store, jdbc, id);
            }
            Thread.sleep(2_000);
            System.out.println("PROBE failures after_poison map_size=" + failures.size());
            String closed = sessions.get("closed");
            awaitOperation(closed, request("POST", "/v1/agents/sessions/" + closed + "/close", null, "f-close", 202)
                    .path("id").asText());
            String deleted = sessions.get("deleted");
            awaitOperation(deleted, request("DELETE", "/v1/agents/sessions/" + deleted, null, "f-delete", 202)
                    .path("id").asText());
            jdbc.update("UPDATE managed_agent_consumer_progress SET covered_sequence = (SELECT last_sequence FROM"
                    + " managed_agent_session s WHERE s.session_id = managed_agent_consumer_progress.session_id)"
                    + " WHERE session_id = ? AND consumer_name = 'message_projection'", sessions.get("healed_elsewhere"));
            int mark = output.getOut().length();
            Thread.sleep(15_000);
            String window = output.getOut().substring(mark);
            var targets = store.findMaterializationTargets(100).stream()
                    .map(target -> target.sessionId()).toList();
            for (var entry : sessions.entrySet()) {
                String id = entry.getValue();
                long warns = window.lines().filter(line -> line.contains("Failed to materialize Managed Agent session "
                        + id)).count();
                List<String> status = jdbc.queryForList("SELECT status FROM managed_agent_session WHERE session_id = ?",
                        String.class, id);
                System.out.println("PROBE failures session=" + entry.getKey() + " row_status=" + status
                        + " still_selected=" + targets.contains(id) + " warns_in_15s=" + warns
                        + " failures_entry=" + failures.get(TENANT + ":" + id));
            }
            System.out.println("PROBE failures after_15s map_size=" + failures.size());
        }
    }

    /** Round 2 (triage follow-up): the Session Store base URL on the real startup path. */
    @Test
    void sessionStoreBaseUrlAtStartup(CapturedOutput output) throws Exception {
        int dead = freePort();
        for (String url : List.of("localhost:4170", "https://", "http://127.0.0.1:" + dead)) {
            int mark = output.getOut().length();
            try (var spring = start("jdbc:h2:mem:store" + Math.abs(url.hashCode())
                    + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE", List.of(
                    "--qwen.managed-agent.harness.enabled=true",
                    "--qwen.managed-agent.harness.token=probe-token",
                    "--qwen.managed-agent.harness.base-url=http://127.0.0.1:" + dead,
                    "--qwen.managed-agent.harness.capability-digest=sha256:" + "a".repeat(64),
                    "--qwen.managed-agent.session-store.enabled=true",
                    "--qwen.managed-agent.session-store.workspace-id=probe-workspace",
                    "--qwen.managed-agent.session-store.base-url=" + url))) {
                String log = output.getOut().substring(mark);
                System.out.println("PROBE store_base_url url=" + url + " -> STARTED warn_lines="
                        + log.lines().filter(line -> line.contains(" WARN ") && line.toLowerCase()
                                .contains("store")).count());
            } catch (Exception error) {
                Throwable root = error;
                while (root.getCause() != null) {
                    root = root.getCause();
                }
                System.out.println("PROBE store_base_url url=" + url + " -> REFUSED TO START: "
                        + root.getClass().getSimpleName() + ": " + root.getMessage());
            }
        }
    }

    private void awaitOperation(String session, String operation) throws Exception {
        long deadline = System.nanoTime() + 30_000_000_000L;
        while (System.nanoTime() < deadline) {
            if ("completed".equals(request("GET", "/v1/agents/sessions/" + session + "/operations/" + operation,
                    null, null, 200).path("status").asText())) {
                return;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("operation did not complete: " + operation);
    }

    // A real permanent failure: an event-sequence gap trips materializeNextBatch's
    // gap guard on every attempt.
    private static void poison(TransactionTemplate tx, ManagedAgentStore store, JdbcTemplate jdbc, String session) {
        tx.executeWithoutResult(ignored -> {
            store.appendPublicEventIfAbsent(TENANT, session, null, "session.title.updated", Map.of("title", "a"),
                    false, "poison-a-" + session);
            store.appendPublicEventIfAbsent(TENANT, session, null, "session.title.updated", Map.of("title", "b"),
                    false, "poison-b-" + session);
            jdbc.update("DELETE FROM managed_agent_event WHERE session_id = ? AND source_key = ?", session,
                    "poison-a-" + session);
        });
    }

    private static boolean caughtUp(JdbcTemplate jdbc, String session) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT s.last_sequence = p.covered_sequence FROM"
                + " managed_agent_session s JOIN managed_agent_consumer_progress p ON p.session_id = s.session_id"
                + " WHERE s.session_id = ?", Boolean.class, session));
    }

    private static void awaitCaughtUp(JdbcTemplate jdbc, String session) throws InterruptedException {
        for (int i = 0; i < 500 && !caughtUp(jdbc, session); i++) {
            Thread.sleep(20);
        }
    }

    private ServletWebServerApplicationContext start(String db, List<String> extra) throws Exception {
        port = freePort();
        List<String> arguments = new ArrayList<>(List.of("--server.address=127.0.0.1", "--server.port=" + port,
                "--spring.datasource.url=" + db, "--spring.datasource.driver-class-name=org.h2.Driver",
                "--spring.datasource.username=sa", "--spring.datasource.password="));
        arguments.addAll(extra);
        return (ServletWebServerApplicationContext) new SpringApplicationBuilder(ManagedAgentServerApplication.class)
                .initializers(context -> context.getBeanFactory().registerSingleton("probeAuthentication",
                        authentication()))
                .run(arguments.toArray(String[]::new));
    }

    private static int freePort() throws Exception {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
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

    private JsonNode request(String method, String path, Object body, String key, Integer expected) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(30)).header("X-Qwen-Tenant-Id", TENANT)
                .header("Accept", "application/json").header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        if (key != null) {
            request.header("Idempotency-Key", key);
        }
        var response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
        if (expected != null && response.statusCode() != expected) {
            throw new AssertionError(method + " " + path + " -> " + response.statusCode() + ": " + response.body());
        }
        var node = response.body().isEmpty() ? json.createObjectNode() : (com.fasterxml.jackson.databind.node.ObjectNode)
                json.readTree(response.body());
        node.put("__status", response.statusCode());
        return node;
    }
}
