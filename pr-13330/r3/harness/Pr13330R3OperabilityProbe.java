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
import java.sql.Connection;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;
import javax.sql.DataSource;
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
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * PR #13330 round-3 verification probe (not part of the PR): operator-visible
 * behaviour of the real ManagedAgentServerApplication (H2) for the startup
 * guards, rename diagnostics, materializer backoff/rotation and the
 * materialization scheduler isolation.
 */
@ExtendWith(OutputCaptureExtension.class)
class Pr13330R3OperabilityProbe {
    private static final String TENANT = "probe-tenant";
    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient http = HttpClient.newHttpClient();
    @TempDir
    Path temporary;
    private int port;

    /** Counts row updates of managed_agent_consumer_progress per session (H2 trigger). */
    public static final class ProgressWrites implements org.h2.api.Trigger {
        static final Map<String, AtomicLong> WRITES = new ConcurrentHashMap<>();

        @Override
        public void fire(Connection connection, Object[] oldRow, Object[] newRow) {
            WRITES.computeIfAbsent(String.valueOf(newRow[1]), ignored -> new AtomicLong()).incrementAndGet();
        }
    }

    /** A 100 ms job on the default scheduler, next to the dispatch scan and lease recovery. */
    public static class DefaultSchedulerTicker {
        static final List<Long> TICKS = new CopyOnWriteArrayList<>();
        static volatile String thread = "";

        @Scheduled(fixedDelay = 100)
        public void tick() {
            TICKS.add(System.nanoTime());
            thread = Thread.currentThread().getName();
        }
    }

    @Test
    void startupValidation(CapturedOutput output) throws Exception {
        int dead = freePort();
        String digest = "sha256:" + "a".repeat(64);
        String deadUrl = "http://127.0.0.1:" + dead;
        List<String> harness = List.of("--qwen.managed-agent.harness.enabled=true",
                "--qwen.managed-agent.harness.token=probe-token",
                "--qwen.managed-agent.harness.capability-digest=" + digest);
        List<Map.Entry<String, List<String>>> configs = new ArrayList<>();
        for (var url : List.of(Map.entry("schemeless", "localhost:4170"), Map.entry("empty", ""),
                Map.entry("ftp", "ftp://host:21"), Map.entry("no_host", "http:///path"),
                Map.entry("userinfo", "http://user:pw@127.0.0.1:" + dead),
                Map.entry("query", deadUrl + "/?q=1"), Map.entry("fragment", deadUrl + "/#frag"),
                Map.entry("upper_scheme", "HTTP://127.0.0.1:" + dead), Map.entry("valid_dead", deadUrl))) {
            configs.add(Map.entry("base_url_" + url.getKey(),
                    List.of("--qwen.managed-agent.harness.base-url=" + url.getValue())));
        }
        for (var lease : List.of(Map.entry("renew_0s", java.util.Arrays.asList("0s", (String) null)),
                Map.entry("renew_999us", java.util.Arrays.asList("999us", (String) null)),
                Map.entry("renew_minus_1s", java.util.Arrays.asList("-1s", (String) null)),
                Map.entry("lease20s_renew20s", List.of("20s", "20s")),
                Map.entry("lease60s_renew31s", List.of("31s", "60s")),
                Map.entry("lease60s_renew30s", List.of("30s", "60s")),
                Map.entry("lease2s_renew500ms_e2e", List.of("500ms", "2s")),
                Map.entry("defaults_60s_20s", java.util.Arrays.asList((String) null, (String) null)))) {
            List<String> args = new ArrayList<>(List.of("--qwen.managed-agent.harness.base-url=" + deadUrl));
            if (lease.getValue().get(0) != null) {
                args.add("--qwen.managed-agent.dispatch.lease-renew-interval=" + lease.getValue().get(0));
            }
            if (lease.getValue().get(1) != null) {
                args.add("--qwen.managed-agent.dispatch.lease-duration=" + lease.getValue().get(1));
            }
            configs.add(Map.entry("lease_" + lease.getKey(), args));
        }
        int index = 0;
        for (var config : configs) {
            List<String> arguments = new ArrayList<>(harness);
            arguments.addAll(config.getValue());
            try (var spring = start("jdbc:h2:mem:cfg" + (index++) + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
                    arguments, null)) {
                String suffix = "";
                if (config.getKey().equals("base_url_valid_dead") || config.getKey().startsWith("base_url_")) {
                    String session = request("POST", "/v1/agents/sessions", Map.of("agent_id", "qwen-code"),
                            "create", null).path("id").asText();
                    int before = output.getOut().length();
                    JsonNode renamed = request("PATCH", "/v1/agents/sessions/" + session,
                            Map.of("title", "Renamed"), "rename", null);
                    String log = output.getOut().substring(before);
                    String warn = log.lines().filter(line -> line.contains(" WARN ") && line.contains("rename failed"))
                            .findFirst().map(line -> line.substring(line.indexOf(" WARN ") + 6).trim()).orElse("-");
                    suffix = " | first_rename=HTTP " + renamed.path("__status").asInt() + " "
                            + renamed.at("/error/code").asText() + " server_log_lines=" + log.lines().count()
                            + " rename_warn=\"" + (warn.length() > 160 ? warn.substring(0, 160) : warn) + "\""
                            + " cause_in_log=" + (log.contains("ConnectException") || log.contains("Connection refused")
                                    || log.contains("IllegalArgumentException") || log.contains("URISyntax"));
                }
                System.out.println("PROBE startup config=" + config.getKey() + " -> STARTED" + suffix);
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
                "--qwen.managed-agent.runtime-broker.credential-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
                null)) {
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
                List.of("--qwen.managed-agent.harness.enabled=false"), null)) {
            JdbcTemplate jdbc = spring.getBean(JdbcTemplate.class);
            ManagedAgentStore store = spring.getBean(ManagedAgentStore.class);
            var tx = new TransactionTemplate(spring.getBean(PlatformTransactionManager.class));
            jdbc.execute("CREATE TRIGGER probe_progress_writes AFTER UPDATE ON managed_agent_consumer_progress"
                    + " FOR EACH ROW CALL '" + ProgressWrites.class.getName() + "'");
            // 1. One permanently poisoned Session: warn and progress-row write rate over 40 s.
            String single = request("POST", "/v1/agents/sessions", Map.of("agent_id", "qwen-code"), "single", null)
                    .path("id").asText();
            awaitCaughtUp(jdbc, single);
            poison(tx, store, jdbc, single);
            String marker = "Failed to materialize Managed Agent session " + single;
            int mark = output.getOut().length();
            long writes0 = writes(single);
            long start = System.nanoTime();
            StringBuilder series = new StringBuilder();
            long previous = 0;
            for (int second = 1; second <= 40; second++) {
                Thread.sleep(Math.max(0, start + second * 1_000_000_000L - System.nanoTime()) / 1_000_000L);
                long total = output.getOut().substring(mark).lines().filter(line -> line.contains(marker)).count();
                series.append(second == 1 ? "" : ",").append(total - previous);
                previous = total;
            }
            String window = output.getOut().substring(mark);
            System.out.println("PROBE materializer single_poisoned warns_per_second=[" + series + "] total_40s="
                    + previous + " stack_traces=" + window.lines().filter(line -> line.startsWith("\tat ")
                            && line.contains("materializeNextBatch")).count()
                    + " defer_warns=" + window.lines().filter(line -> line.contains("Failed to defer")).count()
                    + " progress_row_writes_40s=" + (writes(single) - writes0));
            jdbc.update("DELETE FROM managed_agent_consumer_progress WHERE session_id = ?", single);

            // 2. Window edge: 32 poisoned only (window exactly full) then one more (saturated).
            List<String> poisoned = new ArrayList<>();
            for (int index = 0; index < 34; index++) {
                poisoned.add(request("POST", "/v1/agents/sessions", Map.of("agent_id", "qwen-code"), "p" + index,
                        null).path("id").asText());
            }
            for (String id : poisoned) {
                awaitCaughtUp(jdbc, id);
            }
            for (String id : poisoned.subList(0, 32)) {
                poison(tx, store, jdbc, id);
            }
            Thread.sleep(8_000); // past the 1,2,4 ladder so the skip path dominates
            long w32 = totalWrites();
            long m32 = output.getOut().length();
            Thread.sleep(10_000);
            System.out.println("PROBE materializer poisoned=32 (window exactly full) progress_writes_per_s="
                    + (totalWrites() - w32) / 10 + " warns_10s=" + output.getOut().substring((int) m32).lines()
                            .filter(line -> line.contains("Failed to materialize Managed Agent session")).count());
            poison(tx, store, jdbc, poisoned.get(32));
            Thread.sleep(8_000);
            long w33 = totalWrites();
            long m33 = output.getOut().length();
            Thread.sleep(10_000);
            System.out.println("PROBE materializer poisoned=33 (saturated) progress_writes_per_s="
                    + (totalWrites() - w33) / 10 + " warns_10s=" + output.getOut().substring((int) m33).lines()
                            .filter(line -> line.contains("Failed to materialize Managed Agent session")).count());

            // 3. Starvation: a healthy Session behind 33 poisoned ones receives a new event.
            String healthy = poisoned.get(33);
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
        }
    }

    /**
     * The materialization tick blocks on a row lock held by another
     * transaction (H2 LOCK_TIMEOUT 10 s). Does a 100 ms job on the default
     * scheduler keep running?
     */
    @Test
    void materializerStallVersusDefaultScheduler(CapturedOutput output) throws Exception {
        try (var spring = start("jdbc:h2:mem:stall;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;LOCK_TIMEOUT=10000",
                List.of("--qwen.managed-agent.harness.enabled=false"), DefaultSchedulerTicker.class)) {
            JdbcTemplate jdbc = spring.getBean(JdbcTemplate.class);
            ManagedAgentStore store = spring.getBean(ManagedAgentStore.class);
            String session = request("POST", "/v1/agents/sessions", Map.of("agent_id", "qwen-code"), "stall", null)
                    .path("id").asText();
            awaitCaughtUp(jdbc, session);
            Thread.sleep(2_000);
            long baselineFrom = System.nanoTime();
            Thread.sleep(5_000);
            System.out.println("PROBE stall phase=baseline_5s ticker_thread=" + DefaultSchedulerTicker.thread
                    + " max_gap_ms=" + maxGap(baselineFrom, System.nanoTime()) + " ticks=" + ticks(baselineFrom,
                            System.nanoTime()));
            try (Connection holder = spring.getBean(DataSource.class).getConnection()) {
                holder.setAutoCommit(false);
                try (var statement = holder.prepareStatement("UPDATE managed_agent_consumer_progress SET updated_at"
                        + " = updated_at WHERE session_id = ?")) {
                    statement.setString(1, session);
                    statement.executeUpdate();
                }
                store.appendPublicEventIfAbsent(TENANT, session, null, "session.title.updated",
                        Map.of("title", "stall"), false, "probe-stall-1");
                long from = System.nanoTime();
                Thread.sleep(3_000);
                String materializerThread = Thread.getAllStackTraces().entrySet().stream()
                        .filter(entry -> java.util.Arrays.stream(entry.getValue()).anyMatch(frame ->
                                frame.getClassName().endsWith("MessageMaterializer")
                                        && frame.getMethodName().equals("materialize")))
                        .map(entry -> entry.getKey().getName()).findFirst().orElse("<not running>");
                Thread.sleep(22_000);
                long to = System.nanoTime();
                System.out.println("PROBE stall phase=row_lock_held_25s materializer_thread=" + materializerThread
                        + " ticker_thread=" + DefaultSchedulerTicker.thread + " max_gap_ms=" + maxGap(from, to)
                        + " ticks=" + ticks(from, to) + " (expected ~" + 25_000 / 100 + ")");
                holder.rollback();
            }
        }
    }

    private static long maxGap(long from, long to) {
        long previous = from;
        long max = 0;
        for (long tick : DefaultSchedulerTicker.TICKS) {
            if (tick < from || tick > to) {
                continue;
            }
            max = Math.max(max, tick - previous);
            previous = tick;
        }
        max = Math.max(max, to - previous);
        return max / 1_000_000L;
    }

    private static long ticks(long from, long to) {
        return DefaultSchedulerTicker.TICKS.stream().filter(tick -> tick >= from && tick <= to).count();
    }

    private static long writes(String session) {
        AtomicLong count = ProgressWrites.WRITES.get(session);
        return count == null ? 0 : count.get();
    }

    private static long totalWrites() {
        return ProgressWrites.WRITES.values().stream().mapToLong(AtomicLong::get).sum();
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

    private ServletWebServerApplicationContext start(String db, List<String> extra, Class<?> extraSource)
            throws Exception {
        port = freePort();
        List<String> arguments = new ArrayList<>(List.of("--server.address=127.0.0.1", "--server.port=" + port,
                "--spring.datasource.url=" + db, "--spring.datasource.driver-class-name=org.h2.Driver",
                "--spring.datasource.username=sa", "--spring.datasource.password="));
        arguments.addAll(extra);
        SpringApplicationBuilder builder = extraSource == null
                ? new SpringApplicationBuilder(ManagedAgentServerApplication.class)
                : new SpringApplicationBuilder(ManagedAgentServerApplication.class, extraSource);
        return (ServletWebServerApplicationContext) builder
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
