package com.alibaba.qwen.code.managedagent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.alibaba.qwen.code.managedagent.api.AuthenticatedTenantActor;
import com.alibaba.qwen.code.managedagent.api.WorkspaceSelection;
import com.alibaba.qwen.code.managedagent.store.ManagedAgentStore;
import com.alibaba.qwen.code.runtimebroker.WorkspaceExecutionProfile;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.Principal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.awaitility.core.ConditionFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInfo;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.CleanupMode;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.core.Ordered;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * PR 13928 verification probes (not part of the PR). Same real stack as
 * HostedTeamMemberCommandMySqlIT — real Spring on MySQL/MariaDB, the bundled
 * Hosted Harness, the embedded Runtime Broker, a scripted model — plus a
 * pass-through proxy on Spring -> Harness that can answer the relay's
 * `execute` with the lead's own 409 session_command_blocked shape.
 */
class HostedPr13928ProbeMySqlIT {
    private static final String TOKEN = "pr13928-probe";
    private static final String DIGEST = "sha256:" + "c".repeat(64);
    private static final String LOCK =
            "The leader is not answering; end your turn.";
    private static final Pattern MEMBER = Pattern.compile(
            "PRB_MEMBER_([a-z]+)_GO");
    private static final Pattern LEAD = Pattern.compile(
            "PRB_LEAD_([A-Z]+)");
    private static final Pattern TEAMMATE = Pattern.compile(
            "<teammate>([^<]+)</teammate>");
    private static final Map<String, List<String>> ROSTER = Map.of(
            "RULES", List.of("alice", "bob"),
            "TIMEOUT", List.of("dave"),
            "ACCEPTING", List.of("erin"),
            "MIXED", List.of("frank"),
            "PLANNED", List.of("gina"),
            "WAKEMSG", List.of("hana"));

    private final ObjectMapper json = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT);
    private final HttpClient http = HttpClient.newHttpClient();
    private final String tenant = "pr13928-" + UUID.randomUUID();
    private final AtomicReference<Throwable> modelFailure =
            new AtomicReference<>();
    private final Set<String> seenReports = new CopyOnWriteArraySet<>();
    private final Set<String> launched = new CopyOnWriteArraySet<>();
    private final Set<String> boardRead = new CopyOnWriteArraySet<>();
    private final Set<String> messagesSent = new CopyOnWriteArraySet<>();
    /** Every tool answer the model saw, by call id, as plain text. */
    private final Map<String, String> results = new ConcurrentHashMap<>();
    /** When each tool answer was first seen by the model (ms). */
    private final Map<String, Long> resultSeenAt = new ConcurrentHashMap<>();
    private final List<String> timeline = new CopyOnWriteArrayList<>();
    /** The tool names each member's first model request declared. */
    private final Map<String, List<String>> declared = new ConcurrentHashMap<>();
    private final long started = System.currentTimeMillis();
    @TempDir(cleanup = CleanupMode.ON_SUCCESS)
    private Path temporary;
    private ServletWebServerApplicationContext spring;
    private HttpServer model;
    private ExecutorService modelThreads;
    private volatile String leadSession;
    private volatile Process harness;
    private volatile Process proxy;
    private volatile JdbcTemplate jdbc;
    private int harnessPort;
    private int proxyPort;
    private int brokerPort;
    private int port;
    private String testName = "probe";

    @BeforeEach
    void name(TestInfo info) {
        testName = info.getTestMethod().get().getName().substring(0, 2);
    }

    @AfterEach
    void tearDown(TestInfo info) throws Exception {
        try {
            dumpEvidence(info.getTestMethod().get().getName());
        } catch (Exception failure) {
            System.out.println("evidence dump failed: " + failure);
        }
        if (harness != null) {
            harness.destroy();
            harness.waitFor(20, TimeUnit.SECONDS);
        }
        if (proxy != null) {
            proxy.destroy();
            proxy.waitFor(10, TimeUnit.SECONDS);
        }
        if (spring != null) spring.close();
        if (model != null) model.stop(0);
        if (modelThreads != null) modelThreads.shutdownNow();
    }

    // ------------------------------------------------------------ probes

    /**
     * P1: member board rules across two members on the real stack, plus the
     * R3 regression (a task subject equal to the fixed lock text must not
     * lock the Turn's next command).
     */
    @Test
    @Timeout(360)
    void p1BoardRulesAcrossMembersAndLockTextAsData() throws Exception {
        boot(false);
        String lead = createLead("PRB_LEAD_RULES");
        waiting().atMost(Duration.ofSeconds(300))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(seenReports).contains("alice", "bob");
                    assertThat(results).containsKey("lead-list-RULES");
                });
        mark("all reports + lead board read seen");
        settleRelay();
        closeAndSettle(lead);
    }

    /**
     * P2: the relay's execute is held (409 session_command_blocked, which
     * the relay retries forever without spending attempts). The member's
     * own 2-minute bound must answer the handed-over command and lock the
     * rest of the Turn; releasing the hold afterwards must not execute it.
     */
    @Test
    @Timeout(420)
    void p2HeldExecuteTimesOutAndLocksTheTurn() throws Exception {
        boot(true);
        String lead = createLead("PRB_LEAD_TIMEOUT");
        waiting().atMost(Duration.ofSeconds(330))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("dave-1");
                });
        mark("dave's second command answered; releasing the hold");
        Files.deleteIfExists(temporary.resolve("ctl/hold-execute"));
        waiting().atMost(Duration.ofSeconds(120))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(seenReports).contains("dave");
                    assertThat(results).containsKey("lead-list-TIMEOUT");
                });
        mark("dave reported + lead board read seen");
        settleRelay();
        closeAndSettle(lead);
    }

    /**
     * P3: the command is handed over (accepting) while execute is held; the
     * Harness is killed and restarted, then the hold is released. The
     * resumed wait must fold the lead's real reply (consumed), exactly one
     * execute must reach the lead, and the report must land.
     */
    @Test
    @Timeout(300)
    void p3HarnessRestartWhileHandedOver() throws Exception {
        boot(true);
        String lead = createLead("PRB_LEAD_ACCEPTING");
        waiting().atMost(Duration.ofSeconds(90))
                .pollInterval(Duration.ofMillis(200)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(openTurns(lead)).isEmpty();
                    assertThat(commandStates(lead)).contains("accepting");
                    assertThat(proxyLog("held")).isGreaterThanOrEqualTo(1);
                });
        mark("erin's command is accepting and execute was held; killing the Harness");
        harness.descendants().forEach(ProcessHandle::destroyForcibly);
        harness.destroyForcibly();
        harness.waitFor(20, TimeUnit.SECONDS);
        startHarness();
        mark("Harness restarted");
        Thread.sleep(3000);
        Files.deleteIfExists(temporary.resolve("ctl/hold-execute"));
        mark("hold released");
        waiting().atMost(Duration.ofSeconds(150))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(commandStates(lead)).containsOnly("consumed");
                    assertThat(childResultAccepted(lead)).isTrue();
                    assertThat(memberTurnStatuses(lead)).containsOnly("COMPLETED");
                });
        mark("erin's command consumed, her Turn completed and her result accepted");
        settleRelay();
        closeAndSettle(lead);
    }

    /**
     * P5: the PR's own restart scenario, made deterministic: the member's
     * handover is refused so her entry stays `planned` while she is parked;
     * the Harness is killed and restarted, then the hold is released. The
     * resumed wait must hand over, fold the reply (consumed), complete her
     * Turn and land her report.
     */
    @Test
    @Timeout(300)
    void p5HarnessRestartWhilePlanned() throws Exception {
        boot(false);
        Files.writeString(temporary.resolve("ctl/hold-handover"), "1");
        String lead = createLead("PRB_LEAD_PLANNED");
        waiting().atMost(Duration.ofSeconds(90))
                .pollInterval(Duration.ofMillis(200)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(openTurns(lead)).isEmpty();
                    assertThat(commandStates(lead)).contains("planned");
                    assertThat(proxyLog("held-handover"))
                            .isGreaterThanOrEqualTo(1);
                });
        mark("gina's command is planned and parked, handover refused; killing the Harness");
        harness.descendants().forEach(ProcessHandle::destroyForcibly);
        harness.destroyForcibly();
        harness.waitFor(20, TimeUnit.SECONDS);
        startHarness();
        mark("Harness restarted");
        Thread.sleep(3000);
        Files.deleteIfExists(temporary.resolve("ctl/hold-handover"));
        mark("hold released");
        waiting().atMost(Duration.ofSeconds(170))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(commandStates(lead)).containsOnly("consumed");
                    assertThat(childResultAccepted(lead)).isTrue();
                    assertThat(memberTurnStatuses(lead)).containsOnly("COMPLETED");
                });
        mark("gina's command consumed, her Turn completed and her result accepted");
        settleRelay();
        closeAndSettle(lead);
    }

    /**
     * P6: P5's restart, then a long observation (no assertion until the
     * end): does the parked member ever resume, time out, or get cancelled?
     */
    @Test
    @Timeout(900)
    void p6PlannedRestartObservedTenMinutes() throws Exception {
        boot(false);
        Files.writeString(temporary.resolve("ctl/hold-handover"), "1");
        String lead = createLead("PRB_LEAD_PLANNED");
        waiting().atMost(Duration.ofSeconds(90))
                .pollInterval(Duration.ofMillis(200)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(openTurns(lead)).isEmpty();
                    assertThat(commandStates(lead)).contains("planned");
                    assertThat(proxyLog("held-handover"))
                            .isGreaterThanOrEqualTo(1);
                });
        mark("gina planned + parked; killing the Harness");
        harness.descendants().forEach(ProcessHandle::destroyForcibly);
        harness.destroyForcibly();
        harness.waitFor(20, TimeUnit.SECONDS);
        startHarness();
        mark("Harness restarted");
        Thread.sleep(3000);
        Files.deleteIfExists(temporary.resolve("ctl/hold-handover"));
        mark("hold released");
        String last = "";
        long end = System.currentTimeMillis() + 600_000;
        while (System.currentTimeMillis() < end) {
            String now = "command=" + commandStates(lead) + " memberTurn="
                    + memberTurnStatuses(lead) + " accepted="
                    + childResultCount(lead);
            if (!now.equals(last)) {
                mark("state " + now);
                last = now;
            }
            if (memberTurnStatuses(lead).stream()
                    .noneMatch("RUNNING"::equals)) break;
            Thread.sleep(5000);
        }
        mark("observation ended: " + last);
        assertThat(memberTurnStatuses(lead)).containsOnly("COMPLETED");
    }

    /**
     * P7: P5's restart with a wake input already on the member's journal:
     * while hana is parked (planned, handover refused) the lead sends her a
     * message, the relay delivers it, then the Harness dies (#13873 shape).
     */
    @Test
    @Timeout(420)
    void p7PlannedRestartWithPendingWakeInput() throws Exception {
        boot(false);
        Files.writeString(temporary.resolve("ctl/hold-handover"), "1");
        String lead = createLead("PRB_LEAD_WAKEMSG");
        waiting().atMost(Duration.ofSeconds(90))
                .pollInterval(Duration.ofMillis(200)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(openTurns(lead)).isEmpty();
                    assertThat(commandStates(lead)).contains("planned");
                    assertThat(proxyLog("held-handover"))
                            .isGreaterThanOrEqualTo(1);
                });
        mark("hana planned + parked; asking the lead to message her");
        request("POST", "/v1/agents/sessions/" + lead + "/events",
                Map.of("type", "agent.session.input.message", "input",
                        List.of(Map.of("type", "input_text", "text",
                                "PRB_SEND_HANA"))),
                "input-send-hana", 202);
        waiting().atMost(Duration.ofSeconds(90))
                .pollInterval(Duration.ofMillis(200)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(openTurns(lead)).isEmpty();
                    assertThat(proxyLogKind("receive", "forwarded"))
                            .isGreaterThanOrEqualTo(1);
                });
        mark("the lead's message was received on hana's journal; killing the Harness");
        harness.descendants().forEach(ProcessHandle::destroyForcibly);
        harness.destroyForcibly();
        harness.waitFor(20, TimeUnit.SECONDS);
        startHarness();
        mark("Harness restarted");
        Thread.sleep(3000);
        Files.deleteIfExists(temporary.resolve("ctl/hold-handover"));
        mark("hold released");
        String last = "";
        long end = System.currentTimeMillis() + 300_000;
        while (System.currentTimeMillis() < end) {
            String now = "command=" + commandStates(lead) + " memberTurns="
                    + memberTurnStatuses(lead) + " accepted="
                    + childResultCount(lead);
            if (!now.equals(last)) {
                mark("state " + now);
                last = now;
            }
            if (commandStates(lead).stream().allMatch("consumed"::equals)
                    && memberTurnStatuses(lead).stream()
                            .noneMatch("RUNNING"::equals)
                    && childResultCount(lead) > 0) break;
            Thread.sleep(5000);
        }
        mark("observation ended: " + last);
        assertThat(commandStates(lead)).containsOnly("consumed");
        assertThat(memberTurnStatuses(lead)).doesNotContain("RUNNING");
    }

    /**
     * P4: a board command batched beside a Workspace tool is refused, and
     * the member can still report.
     */
    @Test
    @Timeout(240)
    void p4BoardCommandBesideWorkspaceToolIsRefused() throws Exception {
        boot(false);
        String lead = createLead("PRB_LEAD_MIXED");
        waiting().atMost(Duration.ofSeconds(180))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("lead-list-MIXED");
                });
        mark("lead board read seen");
        settleRelay();
        closeAndSettle(lead);
    }

    // ------------------------------------------------------------ evidence

    private void mark(String what) {
        String line = String.format("+%6.1fs %s",
                (System.currentTimeMillis() - started) / 1000.0, what);
        timeline.add(line);
        System.out.println("[probe] " + line);
    }

    private void settleRelay() {
        waiting().atMost(Duration.ofSeconds(60))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() ->
                        assertThat(jdbc.queryForList(
                                "SELECT message_id, state FROM"
                                        + " qwen_managed_session_message_relay"
                                        + " WHERE tenant_id = ? AND state NOT IN"
                                        + " ('done','unknown')", tenant))
                                .isEmpty());
    }

    private void dumpEvidence(String test) throws Exception {
        if (jdbc == null) return;
        Path out = Path.of(System.getProperty("probe.out",
                "target/pr13928-probe"));
        Files.createDirectories(out);
        Map<String, Object> evidence = new LinkedHashMap<>();
        evidence.put("test", test);
        evidence.put("tenant", tenant);
        evidence.put("timeline", timeline);
        Map<String, Object> answers = new LinkedHashMap<>();
        results.keySet().stream().sorted((a, b) -> Long.compare(
                resultSeenAt.getOrDefault(a, 0L),
                resultSeenAt.getOrDefault(b, 0L)))
                .forEach(key -> answers.put(key, Map.of(
                        "seenAtSec", (resultSeenAt.getOrDefault(key, 0L)
                                - started) / 1000.0,
                        "text", results.get(key))));
        evidence.put("toolAnswers", answers);
        evidence.put("reports", seenReports);
        evidence.put("declaredTools", declared);
        if (leadSession != null) {
            List<Object> board = new ArrayList<>();
            for (Map<String, Object> row : rows(leadSession, "team_task"))
                board.add(Map.of("revision", row.get("revision"),
                        "body", body(row)));
            evidence.put("leadBoard", board);
            List<Object> receipts = new ArrayList<>();
            for (Map<String, Object> row : rows(leadSession, "session_command"))
                receipts.add(Map.of("recordId", row.get("record_id"),
                        "revision", row.get("revision"), "body", body(row)));
            evidence.put("leadInboundReceipts", receipts);
            Map<String, Object> members = new LinkedHashMap<>();
            for (String child : children(leadSession)) {
                List<Object> commands = new ArrayList<>();
                for (Map<String, Object> row : jdbc.queryForList(
                        "SELECT record_id, revision, delivery_state FROM"
                                + " qwen_managed_session_extension_record"
                                + " WHERE tenant_id = ? AND session_id = ?"
                                + " AND domain = 'session_command'"
                                + " ORDER BY record_id, revision",
                        tenant, child))
                    commands.add(row);
                members.put(child, commands);
            }
            evidence.put("memberCommandRevisions", members);
            evidence.put("relayRows", jdbc.queryForList(
                    "SELECT sender_session_id, target_session_id, state,"
                            + " attempts, last_error FROM"
                            + " qwen_managed_session_message_relay WHERE"
                            + " tenant_id = ?", tenant));
            evidence.put("turns", jdbc.queryForList(
                    "SELECT session_id, status, error_code FROM"
                            + " managed_agent_turn WHERE tenant_id = ?"
                            + " ORDER BY created_at", tenant));
            List<Object> childRuns = new ArrayList<>();
            for (Map<String, Object> row : rows(leadSession, "child_run")) {
                JsonNode run = body(row);
                childRuns.add(Map.of("name", run.at("/name").asText(""),
                        "state", run.at("/run/state").asText()));
            }
            evidence.put("childRuns", childRuns);
            evidence.put("acceptChildResult", childResultCount(leadSession));
        }
        Path proxyLog = temporary.resolve("proxy.jsonl");
        if (Files.exists(proxyLog)) {
            List<Object> ops = new ArrayList<>();
            for (String line : Files.readAllLines(proxyLog))
                ops.add(json.readTree(line));
            evidence.put("proxyMessageOperations", ops);
        }
        Files.writeString(out.resolve(test + ".json"),
                json.writeValueAsString(evidence));
        System.out.println("[probe] evidence -> " + out.resolve(test + ".json"));
    }

    // ------------------------------------------------------------ scenario plumbing

    private String createLead(String marker) throws Exception {
        TransactionTemplate transaction = new TransactionTemplate(
                spring.getBean(PlatformTransactionManager.class));
        ManagedAgentStore store = spring.getBean(ManagedAgentStore.class);
        transaction.execute(status -> {
            var created = store.insertInternalTeamLeadSessionCommand(tenant,
                    "actor", "create-" + marker, DIGEST, null,
                    new WorkspaceSelection("workspace-0", "child"));
            leadSession = created.sessionId();
            return created.sessionId();
        });
        waiting().atMost(Duration.ofSeconds(30))
                .pollInterval(Duration.ofSeconds(1)).ignoreExceptions()
                .untilAsserted(() -> request("POST",
                        "/v1/agents/sessions/" + leadSession + "/events",
                        Map.of("type", "agent.session.input.message",
                                "input",
                                List.of(Map.of("type", "input_text", "text",
                                        marker))),
                        "input-" + marker, 202));
        mark("lead created " + leadSession);
        return leadSession;
    }

    private void closeAndSettle(String lead) throws Exception {
        JsonNode closed = null;
        try {
            closed = request("POST", "/v1/agents/sessions/" + lead
                    + "/close", null, "close-" + lead, 202);
        } catch (AssertionError failure) {
            if (!String.valueOf(failure.getMessage())
                    .contains("workspace_unavailable")) {
                throw failure;
            }
        }
        if (closed != null) {
            String operation = closed.path("id").asText();
            waiting().atMost(Duration.ofSeconds(20))
                    .pollInterval(Duration.ofMillis(500))
                    .untilAsserted(() ->
                            assertThat(operationStatus(lead, operation))
                                    .isEqualTo("completed"));
        }
        waiting().atMost(Duration.ofSeconds(30))
                .pollInterval(Duration.ofMillis(500)).untilAsserted(() ->
                        assertThat(jdbc.queryForList(
                                "SELECT session_id, status FROM managed_agent_turn"
                                        + " WHERE tenant_id = ? AND status NOT IN"
                                        + " ('COMPLETED', 'FAILED', 'CANCELLED')",
                                tenant)).isEmpty());
        mark("all turns terminal");
    }

    // ------------------------------------------------------------ the model

    private void modelReply(HttpExchange exchange) throws IOException {
        try {
            JsonNode body = json.readTree(exchange.getRequestBody());
            recordResults(body);
            String first = firstUserText(body);
            Matcher member = MEMBER.matcher(first);
            if (member.find()) {
                List<String> tools = new ArrayList<>();
                for (JsonNode tool : body.path("tools"))
                    tools.add(tool.path("function").path("name").asText());
                declared.putIfAbsent(member.group(1), tools);
                reply(exchange, memberPlan(member.group(1), body));
                return;
            }
            Matcher lead = LEAD.matcher(first);
            if (lead.find()) {
                reply(exchange, leadPlan(lead.group(1), body));
                return;
            }
            throw new AssertionError("Unknown model request: " + first);
        } catch (Exception | AssertionError failure) {
            modelFailure.compareAndSet(null, failure);
            try {
                reply(exchange, List.of(), null);
            } catch (Exception ignored) {
            }
        } finally {
            exchange.close();
        }
    }

    private void recordResults(JsonNode body) {
        for (JsonNode message : body.path("messages")) {
            if (!"tool".equals(message.path("role").asText())) continue;
            String id = message.path("tool_call_id").asText();
            String text = plain(message.path("content").isTextual()
                    ? message.path("content").asText()
                    : message.path("content").toString());
            if (results.putIfAbsent(id, text) == null) {
                resultSeenAt.put(id, System.currentTimeMillis());
                mark("model saw " + id + ": "
                        + text.replace("\n", " | ").substring(0,
                                Math.min(160, text.length())));
            }
        }
    }

    private Step leadPlan(String kind, JsonNode body) {
        if (lastUserText(body).contains("PRB_SEND_HANA")
                && messagesSent.add("hana")) {
            mark("lead sends a message to hana");
            return new Step(List.of(call("lead-msg-hana", "send_message",
                    Map.of("to", "hana", "message",
                            "PRB_NOTE extra context from the lead"))), null);
        }
        long rounds = countRoleTool(body);
        seenReports.addAll(reportedIn(body));
        List<String> roster = ROSTER.get(kind);
        Set<String> reported = new LinkedHashSet<>(seenReports);
        boolean wake = roster.stream().anyMatch(reported::contains);
        if (!wake) {
            if (rounds == 0) {
                return new Step(List.of(call("lead-create-" + kind,
                        "team_create", Map.of("team_name", "probe"))), null);
            }
            if (rounds == 1 && launched.add(roster.get(0))) {
                return new Step(List.of(launch(roster.get(0))), null);
            }
            return new Step(List.of(), "LEAD_IDLE");
        }
        for (String name : roster) {
            if (!reported.contains(name)) {
                if (launched.add(name))
                    return new Step(List.of(launch(name)), null);
                return new Step(List.of(), "LEAD_IDLE");
            }
        }
        if (boardRead.add(kind)) {
            return new Step(List.of(call("lead-list-" + kind, "task_list",
                    Map.of())), null);
        }
        return new Step(List.of(), "LEAD_IDLE");
    }

    private Map<String, Object> launch(String name) {
        mark("lead launches " + name);
        return call("lead-launch-" + name, "agent", Map.of(
                "description", name + " probe",
                "prompt", "PRB_MEMBER_" + name + "_GO",
                "name", name));
    }

    private static Set<String> reportedIn(JsonNode body) {
        Set<String> names = new LinkedHashSet<>();
        for (JsonNode message : body.path("messages")) {
            if (!"user".equals(message.path("role").asText())) continue;
            names.addAll(teammates(message.toString()));
        }
        return names;
    }

    private Step memberPlan(String name, JsonNode body) {
        long step = countRoleTool(body);
        switch (name) {
            case "alice" -> {
                if (step == 0)
                    return one("alice-0", "task_create", Map.of(
                            "subject", "Audit one",
                            "description", "alice's own task"));
                if (step == 1)
                    return one("alice-1", "task_update", Map.of(
                            "taskId", number("alice-0"),
                            "status", "in_progress"));
                return report(name);
            }
            case "bob" -> {
                String alices = number("alice-0");
                if (step == 0)
                    return one("bob-0", "task_update", Map.of(
                            "taskId", alices, "status", "completed"));
                if (step == 1)
                    return one("bob-1", "task_create", Map.of(
                            "subject", LOCK,
                            "description", "the lock text, as plain data"));
                if (step == 2)
                    return one("bob-2", "task_list", Map.of());
                if (step == 3)
                    return one("bob-3", "task_create", Map.of(
                            "subject", "After lock text",
                            "description", "must still be sent"));
                if (step == 4)
                    return one("bob-4", "task_update", Map.of(
                            "taskId", number("bob-1"), "owner", "alice"));
                if (step == 5)
                    return one("bob-5", "task_update", Map.of(
                            "taskId", alices, "owner", ""));
                if (step == 6)
                    return one("bob-6", "task_update", Map.of(
                            "taskId", number("bob-3"), "status", "deleted"));
                if (step == 7)
                    return one("bob-7", "task_update", Map.of(
                            "taskId", number("bob-3"),
                            "subject", "edit after delete"));
                return report(name);
            }
            case "dave" -> {
                if (step == 0)
                    return one("dave-0", "task_create", Map.of(
                            "subject", "Held write",
                            "description", "the relay's execute is held"));
                if (step == 1)
                    return one("dave-1", "task_create", Map.of(
                            "subject", "Second write",
                            "description", "after the wait timed out"));
                return report(name);
            }
            case "erin" -> {
                if (step == 0)
                    return one("erin-0", "task_create", Map.of(
                            "subject", "Accepting audit",
                            "description", "handed over, then the Harness dies"));
                return report(name);
            }
            case "gina" -> {
                if (step == 0)
                    return one("gina-0", "task_create", Map.of(
                            "subject", "Planned audit",
                            "description", "parked while planned, then the Harness dies"));
                return report(name);
            }
            case "hana" -> {
                if (step == 0)
                    return one("hana-0", "task_create", Map.of(
                            "subject", "Wake audit",
                            "description", "parked while a lead message is pending"));
                return report(name);
            }
            case "frank" -> {
                if (step == 0)
                    return new Step(List.of(
                            call("frank-0a", "task_list", Map.of()),
                            call("frank-0b", "read_file",
                                    Map.of("file_path", "README.md"))),
                            null);
                if (step == 2)
                    return one("frank-1", "task_list", Map.of());
                return report(name);
            }
            default -> throw new AssertionError("Unknown member " + name);
        }
    }

    private static Step one(String id, String tool, Map<String, Object> args) {
        return new Step(List.of(call(id, tool, args)), null);
    }

    private static Step report(String name) {
        return new Step(List.of(), name.toUpperCase() + "_REPORT done");
    }

    /** The task number a create answered with, from the model-visible text. */
    private String number(String callId) {
        String text = results.get(callId);
        if (text == null)
            throw new AssertionError("no answer yet for " + callId);
        Matcher number = Pattern.compile("Task #(\\d+) created").matcher(text);
        if (!number.find())
            throw new AssertionError(callId + " answered without a number: "
                    + text);
        return number.group(1);
    }

    private record Step(List<Map<String, Object>> calls, String text) {
    }

    private static String plain(String text) {
        String out = text;
        for (int pass = 0; pass < 4; pass++)
            out = out.replace("\\\\", "\\").replace("\\\"", "\"")
                    .replace("\\n", "\n");
        return out;
    }

    private static long countRoleTool(JsonNode body) {
        long results = 0;
        for (JsonNode message : body.path("messages"))
            if ("tool".equals(message.path("role").asText())) results += 1;
        return results;
    }

    private static Map<String, Object> call(String id, String name,
            Map<String, Object> args) {
        return Map.of("id", id, "name", name, "args", args);
    }

    private void reply(HttpExchange exchange, Step step) throws IOException {
        reply(exchange, step.calls(), step.text());
    }

    private void reply(HttpExchange exchange,
            List<Map<String, Object>> calls, String text) throws IOException {
        ObjectMapper compact = new ObjectMapper();
        ObjectNode chunk = compact.createObjectNode().put("id", "pr13928")
                .put("object", "chat.completion.chunk").put("created", 0)
                .put("model", "pr13928-fixture");
        ObjectNode choice = chunk.putArray("choices").addObject()
                .put("index", 0);
        ObjectNode delta = choice.putObject("delta").put("role",
                "assistant");
        if (calls.isEmpty()) {
            delta.put("content", text == null ? "" : text);
        } else {
            ArrayNode toolCalls = delta.putArray("tool_calls");
            for (int index = 0; index < calls.size(); index++) {
                Map<String, Object> call = calls.get(index);
                toolCalls.addObject().put("index", index)
                        .put("id", call.get("id").toString())
                        .put("type", "function")
                        .putObject("function")
                        .put("name", call.get("name").toString())
                        .put("arguments",
                                compact.writeValueAsString(call.get("args")));
            }
        }
        choice.putNull("finish_reason");
        String first = "data: " + compact.writeValueAsString(chunk) + "\n\n";
        choice.putObject("delta");
        choice.put("finish_reason", calls.isEmpty() ? "stop" : "tool_calls");
        byte[] response = (first + "data: "
                + compact.writeValueAsString(chunk) + "\n\ndata: [DONE]\n\n")
                .getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type",
                "text/event-stream");
        exchange.sendResponseHeaders(200, response.length);
        exchange.getResponseBody().write(response);
    }

    // ------------------------------------------------------------- queries

    private static String firstUserText(JsonNode body) {
        for (JsonNode message : body.path("messages")) {
            if (!"user".equals(message.path("role").asText())) continue;
            String text = message.path("content").isTextual()
                    ? message.path("content").asText()
                    : message.path("content").toString();
            if (text.contains("PRB_")) return text;
        }
        return "";
    }

    private static String lastUserText(JsonNode body) {
        String last = "";
        for (JsonNode message : body.path("messages")) {
            if (!"user".equals(message.path("role").asText())) continue;
            last = message.path("content").isTextual()
                    ? message.path("content").asText()
                    : message.path("content").toString();
        }
        return last;
    }

    private static Set<String> teammates(String text) {
        Set<String> names = new LinkedHashSet<>();
        Matcher matcher = TEAMMATE.matcher(text.replace("\\u003c", "<")
                .replace("\\u003e", ">"));
        while (matcher.find()) names.add(matcher.group(1));
        return names;
    }

    private List<String> children(String lead) {
        return jdbc.queryForList(
                "SELECT session_id FROM managed_agent_session"
                        + " WHERE tenant_id = ? AND parent_session_id = ?",
                String.class, tenant, lead);
    }

    /** The newest delivery state of every member command chain. */
    private List<String> commandStates(String lead) {
        List<String> states = new ArrayList<>();
        for (String child : children(lead)) {
            states.addAll(jdbc.queryForList(
                    "SELECT r.delivery_state FROM"
                            + " qwen_managed_session_extension_record r"
                            + " WHERE r.tenant_id = ? AND r.session_id = ?"
                            + " AND r.domain = 'session_command'"
                            + " AND r.revision = (SELECT MAX(x.revision) FROM"
                            + " qwen_managed_session_extension_record x"
                            + " WHERE x.tenant_id = r.tenant_id AND"
                            + " x.session_id = r.session_id AND x.domain ="
                            + " r.domain AND x.record_id = r.record_id)",
                    String.class, tenant, child));
        }
        return states;
    }

    private List<String> memberTurnStatuses(String lead) {
        List<String> statuses = new ArrayList<>();
        for (String child : children(lead))
            statuses.addAll(jdbc.queryForList(
                    "SELECT status FROM managed_agent_turn WHERE tenant_id = ?"
                            + " AND session_id = ?", String.class, tenant, child));
        return statuses;
    }

    private long proxyLog(String action) throws IOException {
        Path log = temporary.resolve("proxy.jsonl");
        if (!Files.exists(log)) return 0;
        return Files.readAllLines(log).stream()
                .filter(line -> line.contains("\"action\":\"" + action + "\""))
                .count();
    }

    private long proxyLogKind(String kind, String action) throws IOException {
        Path log = temporary.resolve("proxy.jsonl");
        if (!Files.exists(log)) return 0;
        return Files.readAllLines(log).stream()
                .filter(line -> line.contains("\"kind\":\"" + kind + "\"")
                        && line.contains("\"action\":\"" + action + "\""))
                .count();
    }

    private List<Map<String, Object>> rows(String session, String domain) {
        return jdbc.queryForList(
                "SELECT r.record_id, r.revision, CAST(res.inline_bytes AS CHAR)"
                        + " AS body FROM"
                        + " qwen_managed_session_extension_record r"
                        + " JOIN qwen_managed_session_resource res ON"
                        + " res.session_scope_key = r.session_scope_key"
                        + " AND res.resource_id = r.record_resource_id"
                        + " WHERE r.tenant_id = ? AND r.session_id = ?"
                        + " AND r.domain = ? ORDER BY r.record_id, r.revision",
                tenant, session, domain);
    }

    private JsonNode body(Map<String, Object> row) {
        try {
            return json.readTree(row.get("body").toString());
        } catch (IOException failure) {
            throw new AssertionError(failure);
        }
    }

    private String operationStatus(String session, String operation)
            throws Exception {
        return request("GET", "/v1/agents/sessions/" + session + "/operations/"
                + operation, null, null, 200).path("status").asText();
    }

    private void assertNoModelFailure() {
        Throwable failure = modelFailure.get();
        if (failure != null) {
            throw new IllegalStateException("The model fixture failed",
                    failure);
        }
    }

    private List<Map<String, Object>> openTurns(String session) {
        return jdbc.queryForList(
                "SELECT turn_id, status FROM managed_agent_turn"
                        + " WHERE tenant_id = ? AND session_id = ?"
                        + " AND completed_at IS NULL",
                tenant, session);
    }

    private int childResultCount(String lead) {
        Integer accepted = jdbc.queryForObject(
                "SELECT COUNT(*) FROM qwen_managed_session_journal_tx"
                        + " WHERE tenant_id = ? AND session_id = ?"
                        + " AND operation = 'acceptChildResult'",
                Integer.class, tenant, lead);
        return accepted == null ? 0 : accepted;
    }

    private boolean childResultAccepted(String lead) {
        return childResultCount(lead) > 0;
    }

    // ------------------------------------------------------------- the stack

    private void boot(boolean holdExecute) throws Exception {
        Path cli = Path.of(System.getProperty("qwen.cli.entry",
                "../../../dist/cli.js")).toAbsolutePath();
        assertThat(cli).as("Build and bundle the CLI first").isRegularFile();
        String node = System.getProperty("node.executable");
        assertThat(node).isNotBlank();
        assertThat(System.getProperty("mysql.url")).isNotBlank();
        temporary = temporary.toRealPath();
        Files.createDirectory(temporary.resolve("broker"),
                PosixFilePermissions.asFileAttribute(
                        PosixFilePermissions.fromString("rwx------")));
        Path workspace = Files
                .createDirectory(temporary.resolve("workspace-a"));
        Files.createDirectory(workspace.resolve("child"));
        Files.createDirectory(temporary.resolve("harness-decoy"));
        Files.createDirectory(temporary.resolve("ctl"));
        if (holdExecute)
            Files.writeString(temporary.resolve("ctl/hold-execute"), "1");
        port = freePort();
        harnessPort = freePort();
        proxyPort = freePort();
        brokerPort = freePort();
        model = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        modelThreads = Executors.newCachedThreadPool();
        model.setExecutor(modelThreads);
        model.createContext("/v1/chat/completions", this::modelReply);
        model.start();
        startProxy(node);
        startSpring(cli, node, workspace);
        jdbc.update(
                "INSERT INTO managed_workspace_registry (tenant_id, workspace_id,"
                        + " workspace_generation, storage_id, display_name,"
                        + " config_ref, policy_ref, state) VALUES (?,"
                        + " 'workspace-0', 1, 'storage-0', 'PR13928', ?, ?,"
                        + " 'ACTIVE')",
                tenant, WorkspaceExecutionProfile.CONFIG_REF,
                WorkspaceExecutionProfile.POLICY_REF);
        jdbc.update(
                "INSERT INTO managed_workspace_access (tenant_id, workspace_id,"
                        + " actor_id, role) VALUES (?, 'workspace-0', ?,"
                        + " 'OPERATOR')",
                tenant, "actor".getBytes(StandardCharsets.UTF_8));
        startHarness();
        mark("stack up (hold-execute=" + holdExecute + ")");
    }

    private void startProxy(String node) throws Exception {
        String script = System.getProperty("probe.proxy");
        assertThat(script).as("Pass -Dprobe.proxy").isNotBlank();
        proxy = new ProcessBuilder(node, script, Integer.toString(proxyPort),
                Integer.toString(harnessPort),
                temporary.resolve("ctl").toString(),
                temporary.resolve("proxy.jsonl").toString())
                .redirectErrorStream(true)
                .redirectOutput(temporary.resolve("proxy.out").toFile())
                .start();
        waiting().atMost(Duration.ofSeconds(10)).until(() ->
                Files.exists(temporary.resolve("proxy.out"))
                        && Files.readString(temporary.resolve("proxy.out"))
                                .contains("hold-proxy"));
    }

    private void startSpring(Path cli, String node, Path workspace) {
        List<String> arguments = new ArrayList<>(List.of(
                "--server.address=127.0.0.1", "--server.port=" + port,
                "--spring.datasource.url=" + System.getProperty("mysql.url")
                        .replaceFirst("/([A-Za-z0-9_]+)\\?", "/$1_" + testName + "?"),
                "--spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver",
                "--spring.datasource.username=" + System.getProperty("mysql.user"),
                "--spring.datasource.password="
                        + System.getProperty("mysql.password", ""),
                "--qwen.managed-agent.session-store.enabled=true",
                "--qwen.managed-agent.session-store.base-url=http://127.0.0.1:"
                        + port,
                "--qwen.managed-agent.session-store.workspace-id=unused-global-workspace",
                "--qwen.managed-agent.harness.enabled=true",
                "--qwen.managed-agent.harness.workspace-files-enabled=true",
                "--qwen.managed-agent.harness.base-url=http://127.0.0.1:"
                        + proxyPort,
                "--qwen.managed-agent.harness.token=" + TOKEN,
                "--qwen.managed-agent.harness.capability-digest=" + DIGEST,
                "--qwen.managed-agent.runtime-broker.enabled=true",
                "--qwen.managed-agent.runtime-broker.port=" + brokerPort,
                "--qwen.managed-agent.runtime-broker.token=" + TOKEN,
                "--qwen.managed-agent.runtime-broker.durable-local-process=false",
                "--qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false",
                "--qwen.managed-agent.runtime-broker.workspace-cwd="
                        + temporary.resolve("harness-decoy"),
                "--qwen.managed-agent.runtime-broker.state-directory="
                        + temporary.resolve("broker"),
                "--qwen.managed-agent.runtime-broker.credential-key-id=pr13928-fixture",
                "--qwen.managed-agent.runtime-broker.credential-key="
                        + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                "--qwen.managed-agent.runtime-broker.node-executable=" + node,
                "--qwen.managed-agent.runtime-broker.worker-entry=" + cli,
                "--qwen.managed-agent.runtime-broker.cli-entry=" + cli,
                "--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id="
                        + tenant,
                "--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=storage-0",
                "--qwen.managed-agent.runtime-broker.workspace-mounts[0].root="
                        + workspace));
        spring = (ServletWebServerApplicationContext)
                new SpringApplicationBuilder(ManagedAgentServerApplication.class)
                        .initializers(context -> context.getBeanFactory()
                                .registerSingleton("pr13928Authentication",
                                        authentication()))
                        .run(arguments.toArray(String[]::new));
        jdbc = spring.getBean(JdbcTemplate.class);
    }

    private void startHarness() throws Exception {
        String node = System.getProperty("node.executable");
        Path cli = Path.of(System.getProperty("qwen.cli.entry",
                "../../../dist/cli.js")).toAbsolutePath();
        Path home = Files.createDirectory(
                temporary.resolve("home-" + UUID.randomUUID()));
        Path config = Files.createDirectory(home.resolve(".qwen"));
        String modelUrl = "http://127.0.0.1:" + model.getAddress().getPort()
                + "/v1";
        Files.writeString(config.resolve("settings.json"),
                new ObjectMapper().writeValueAsString(Map.of(
                        "security",
                        Map.of("auth", Map.of("selectedType", "openai")),
                        "model", Map.of("name", "pr13928-fixture"),
                        "telemetry", Map.of("enabled", false),
                        "modelProviders",
                        Map.of("openai", List.of(Map.of("id", "pr13928-fixture",
                                "envKey", "OPENAI_API_KEY", "baseUrl",
                                modelUrl))))));
        Path log = temporary.resolve("harness-" + System.currentTimeMillis()
                + ".log");
        ProcessBuilder builder = new ProcessBuilder(node, cli.toString(),
                "serve", "--profile", "hosted-harness", "--http-bridge",
                "--hostname", "127.0.0.1", "--port",
                Integer.toString(harnessPort), "--require-auth", "--no-web",
                "--workspace", temporary.resolve("harness-decoy").toString(),
                "--managed-runtime-broker-url", "http://127.0.0.1:"
                        + brokerPort,
                "--managed-runtime-broker-token", TOKEN)
                .directory(temporary.resolve("harness-decoy").toFile())
                .redirectErrorStream(true).redirectOutput(log.toFile());
        Map<String, String> environment = builder.environment();
        environment.clear();
        if (System.getenv("PATH") != null)
            environment.put("PATH", System.getenv("PATH"));
        environment.putAll(Map.of(
                "HOME", home.toString(),
                "USERPROFILE", home.toString(),
                "QWEN_HOME", config.toString(),
                "QWEN_RUNTIME_DIR", temporary.resolve("runtime").toString(),
                "OPENAI_API_KEY", "fake-local-key",
                "OPENAI_BASE_URL", modelUrl,
                "QWEN_SERVER_TOKEN", TOKEN,
                "QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST", DIGEST));
        environment.put("TMPDIR", temporary.toString());
        environment.put("TMP", temporary.toString());
        environment.put("TEMP", temporary.toString());
        for (String name : List.of("QWEN_CODE_SYSTEM_SETTINGS_PATH",
                "QWEN_CODE_SYSTEM_DEFAULTS_PATH",
                "QWEN_CODE_TRUSTED_FOLDERS_PATH"))
            environment.put(name,
                    temporary.resolve(name + ".json").toString());
        harness = builder.start();
        waiting().atMost(Duration.ofSeconds(30)).untilAsserted(() -> {
            if (!harness.isAlive()) {
                throw new IllegalStateException(
                        "Hosted Harness exited: " + Files.readString(log));
            }
            int status;
            try {
                HttpResponse<String> ready = http.send(
                        HttpRequest.newBuilder(URI.create("http://127.0.0.1:"
                                + harnessPort + "/health"))
                                .header("authorization", "Bearer " + TOKEN)
                                .build(),
                        HttpResponse.BodyHandlers.ofString());
                status = ready.statusCode();
            } catch (IOException ignored) {
                status = -1;
            }
            assertThat(status).isEqualTo(200);
        });
    }

    private JsonNode request(String method, String path, Object body,
            String key, int expected) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(
                URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(15))
                .header("X-Qwen-Tenant-Id", tenant)
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .header("X-Pr13928-Fixture-Actor", "actor")
                .method(method,
                        body == null ? HttpRequest.BodyPublishers.noBody()
                                : HttpRequest.BodyPublishers.ofString(
                                        new ObjectMapper().writeValueAsString(body)));
        if (key != null) request.header("Idempotency-Key", key);
        HttpResponse<String> response = http.send(request.build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode())
                .as("%s %s: %s", method, path, response.body())
                .isEqualTo(expected);
        return json.readTree(response.body());
    }

    private FilterRegistrationBean<Filter> authentication() {
        FilterRegistrationBean<Filter> filter = new FilterRegistrationBean<>(
                (request, response, chain) -> chain.doFilter(
                        new HttpServletRequestWrapper(
                                (HttpServletRequest) request) {
                            @Override
                            public Principal getUserPrincipal() {
                                String actor = getHeader(
                                        "X-Pr13928-Fixture-Actor");
                                return actor == null ? null
                                        : new AuthenticatedTenantActor() {
                                            public String tenantId() {
                                                return tenant;
                                            }

                                            public String actorId() {
                                                return actor;
                                            }

                                            public String getName() {
                                                return actor;
                                            }
                                        };
                            }
                        }, response));
        filter.setOrder(Ordered.HIGHEST_PRECEDENCE);
        filter.setAsyncSupported(true);
        filter.addUrlPatterns("/v1/agents/*");
        return filter;
    }

    private static int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    private static ConditionFactory waiting() {
        return await().failFast("The case's @Timeout interrupted it",
                () -> Thread.currentThread().isInterrupted());
    }
}
