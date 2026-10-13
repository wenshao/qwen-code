/**
 * Copyright 2026 Alibaba Group
 * SPDX-License-Identifier: Apache-2.0
 */

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
import java.util.Base64;
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
import java.util.function.BooleanSupplier;
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
 * PR 13974 (H4e-b3d) physical pass: durable team plans on a real Hosted
 * stack. Spring on MySQL, the embedded Runtime Broker, the packaged Hosted
 * Harness, a logging Spring -> Harness proxy and a Harness -> Session Store
 * proxy that can hold one journal commit by operation. Only the model is
 * scripted. -Dqwen.cli.entry is the test-enabled build (team_plan added to
 * the enabled domains, nothing else), -Dqwen.cli.off the PR as shipped
 * (gate off), -Dqwen.cli.base the merge base (main without this PR).
 */
class HostedPr13974ProbeMySqlIT {
    private static final String TOKEN = "pr13974-probe";
    private static final String DIGEST = "sha256:" + "d".repeat(64);
    private static final Pattern MEMBER = Pattern.compile(
            "PRB_MEMBER_([a-z]+)_GO");
    private static final Pattern TEAM_MEMBER = Pattern.compile(
            "<team-member name=\"([a-z]+)\"");
    private static final Pattern LEAD = Pattern.compile(
            "PRB_LEAD_(P[0-9A-Z]+)");
    private static final Pattern PLAN_REQUEST = Pattern.compile(
            "<plan-approval-request request=\"([^\"]+)\" revision=\"(\\d+)\">");
    private static final String MARKER = "Your next instruction:";
    static final String PLAN_V1 = "PLAN_V1: 1) read README.md 2) write"
            + " plan-output.md with the audit summary.";
    static final String PLAN_V2 = "PLAN_V2: 1) read README.md 2) write"
            + " plan-output.md with the audit summary 3) add a rollback step"
            + " (per feedback).";
    static final String PLAN_V3 = "PLAN_V3: same as V2 plus the audit log"
            + " the lead asked for.";

    private final ObjectMapper json = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT);
    private final ObjectMapper compact = new ObjectMapper();
    private final HttpClient http = HttpClient.newHttpClient();
    private final String tenant = "pr13974-" + UUID.randomUUID();
    private final AtomicReference<Throwable> modelFailure =
            new AtomicReference<>();
    /** Every tool answer the model saw, by call id, as plain text. */
    private final Map<String, String> results = new ConcurrentHashMap<>();
    private final Map<String, Long> resultSeenAt = new ConcurrentHashMap<>();
    private final List<String> timeline = new CopyOnWriteArrayList<>();
    /** member#runTag -> what that run's first model request carried. */
    private final Map<String, Map<String, Object>> memberRuns =
            new ConcurrentHashMap<>();
    /** The tool names each lead turn kind declared (first request). */
    private final Map<String, Object> leadTools = new ConcurrentHashMap<>();
    /** revision -> plan request id, as the lead's notifications named them. */
    private final Map<Integer, String> planRequests = new ConcurrentHashMap<>();
    private final List<Map<String, Object>> leadRequests =
            new CopyOnWriteArrayList<>();
    private final Map<String, List<String>> finals = new ConcurrentHashMap<>();
    private final Set<String> flags = new CopyOnWriteArraySet<>();
    private final Map<String, Object> facts = new ConcurrentHashMap<>();
    private final long started = System.currentTimeMillis();
    @TempDir(cleanup = CleanupMode.ON_SUCCESS)
    private Path temporary;
    private ServletWebServerApplicationContext spring;
    private HttpServer model;
    private ExecutorService modelThreads;
    private volatile String leadSession;
    private volatile String probe = "P0";
    private volatile Process harness;
    private volatile String harnessBuild = "on";
    private volatile boolean approvals;
    private volatile Process proxy;
    private volatile Process storeProxy;
    private volatile JdbcTemplate jdbc;
    private Path workspaceDir;
    private int harnessPort;
    private int proxyPort;
    private int storeProxyPort;
    private int brokerPort;
    private int port;
    private String testName = "probe";

    @BeforeEach
    void name(TestInfo info) {
        testName = info.getTestMethod().get().getName().substring(0, 3)
                .toLowerCase();
    }

    @AfterEach
    void tearDown(TestInfo info) throws Exception {
        try {
            dumpEvidence(info.getTestMethod().get().getName());
        } catch (Exception failure) {
            System.out.println("evidence dump failed: " + failure);
            failure.printStackTrace(System.out);
        }
        killHarness(false);
        for (Process each : new Process[] {proxy, storeProxy}) {
            if (each != null) {
                each.destroy();
                each.waitFor(10, TimeUnit.SECONDS);
            }
        }
        if (spring != null) spring.close();
        if (model != null) model.stop(0);
        if (modelThreads != null) modelThreads.shutdownNow();
    }

    // ------------------------------------------------------------ probes

    /**
     * P1, the design's physical pass: alice (plan_mode_required) reads,
     * is refused a write, submits PLAN_V1; the lead shows and rejects it
     * with feedback; alice is still read-only, submits PLAN_V2; the lead
     * lists the board, messages alice (a continuation that must stay
     * read-only), tries to approve while she runs (refused), approves once
     * she settles; alice's next run edits. bob is a control member launched
     * without plan mode.
     */
    @Test
    @Timeout(600)
    void p1DesignPass() throws Exception {
        probe = "P1";
        boot(false);
        String lead = createLead("PRB_LEAD_P1");
        waiting().atMost(Duration.ofSeconds(480))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("l-final-list");
                    assertThat(runStates(lead).values())
                            .allMatch(state -> !"running".equals(state)
                                    && !"admitted".equals(state));
                });
        mark("P1 settled");
        closeAndSettle(lead);
    }

    /**
     * P1D, the same pass in default approval mode: every Action card that
     * appears (lead or member Session) is approved and recorded, so the
     * cards show which calls asked. exit_plan_mode and team_plan_approval
     * are on the PR's pre-approved list and must not ask.
     */
    @Test
    @Timeout(720)
    void p1dDesignPassDefaultApproval() throws Exception {
        probe = "P1";
        approvals = true;
        boot(false);
        String lead = createLead("PRB_LEAD_P1");
        List<Map<String, Object>> cards = new CopyOnWriteArrayList<>();
        Set<String> answered = new CopyOnWriteArraySet<>();
        facts.put("approvalCards", cards);
        waiting().atMost(Duration.ofSeconds(600))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    approveAll(lead, answered, cards);
                    assertThat(results).containsKey("l-final-list");
                    assertThat(runStates(lead).values())
                            .allMatch(state -> !"running".equals(state)
                                    && !"admitted".equals(state));
                });
        mark("P1D settled; cards: " + cards.stream()
                .map(card -> card.get("session") + ":" + card.get("tool"))
                .toList());
        closeAndSettle(lead);
    }

    private void approveAll(String lead, Set<String> answered,
            List<Map<String, Object>> cards) throws Exception {
        List<String> sessions = new ArrayList<>(List.of(lead));
        for (Map<String, Object> run : childRunSummary(lead))
            if (run.get("childSessionId") != null)
                sessions.add(run.get("childSessionId").toString());
        for (String session : sessions) {
            JsonNode list;
            try {
                list = request("GET", "/v1/agents/sessions/" + session
                        + "/actions", null, null, 200);
            } catch (AssertionError | Exception unreadable) {
                if (answered.add("unreadable:" + session))
                    mark("actions of " + session + " unreadable: "
                            + String.valueOf(unreadable.getMessage())
                                    .substring(0, Math.min(160, String
                                            .valueOf(unreadable.getMessage())
                                            .length())));
                continue;
            }
            for (JsonNode action : list.path("data")) {
                String id = action.path("id").asText();
                if (answered.contains(id)) continue;
                if (!"requested".equals(action.path("state").asText(
                        "requested"))) continue;
                request("POST", "/v1/agents/sessions/" + session + "/actions/"
                        + id + "/responses", Map.of("kind", "permission",
                                "option_id", "allow", "input_revision",
                                action.path("input_revision").asLong(),
                                "policy_revision",
                                action.path("policy_revision").asText()),
                        id, 202);
                answered.add(id);
                Map<String, Object> card = new LinkedHashMap<>();
                card.put("session", session.equals(lead) ? "lead" : session);
                card.put("tool", action.path("tool_name").asText());
                card.put("preview", action.at("/input_preview/text").asText());
                cards.add(card);
                mark("approved card " + card);
            }
        }
    }

    /**
     * P2, bounds and refusals through the real relay: bad launch arguments,
     * an empty, an oversized and a second plan in one run, a member message
     * in plan mode, a bogus request id, a bad action, oversized feedback,
     * maximal-escape feedback, deciding a decided plan, supersession by a
     * later run and deciding the superseded plan, a repeated approval.
     */
    @Test
    @Timeout(600)
    void p2BoundsAndRefusals() throws Exception {
        probe = "P2";
        boot(false);
        String lead = createLead("PRB_LEAD_P2");
        waiting().atMost(Duration.ofSeconds(480))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("l-final-list");
                    assertThat(runStates(lead).values())
                            .allMatch(state -> !"running".equals(state)
                                    && !"admitted".equals(state));
                });
        mark("P2 settled");
        closeAndSettle(lead);
    }

    /**
     * P3a, a decision committed whose continuation never commits: the
     * Store proxy holds the lead's continueChildRun commit, the Harness is
     * killed and restarted. The lead's interrupted team_plan_approval must
     * be answered with the split outcome, never a delivery, and no
     * continuation may launch by itself.
     */
    @Test
    @Timeout(720)
    void p3aDecisionCommittedContinuationLost() throws Exception {
        probe = "P3A";
        boot(true);
        String lead = createLead("PRB_LEAD_P3A");
        waitForHeld(240);
        Map<String, Object> before = new LinkedHashMap<>();
        before.put("plans", planRows(lead));
        before.put("childRuns", childRunSummary(lead));
        facts.put("atHold", before);
        restartHarness("on");
        afterRestart(lead, "l-approve", "PRB_LEAD_P3A_POKE");
        mark("P3a observed");
        closeAndSettle(lead);
    }

    /**
     * After an interrupting restart: wait for the interrupted call's
     * answer; if none arrives, poke the lead with a user input and wait
     * again. Records what happened instead of failing.
     */
    private void afterRestart(String lead, String callId, String poke)
            throws Exception {
        try {
            waiting().atMost(Duration.ofSeconds(150))
                    .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                        assertNoModelFailure();
                        assertThat(results).containsKey(callId);
                    });
            mark(callId + " answered after restart without a poke");
        } catch (Throwable none) {
            mark(callId + " NOT answered 150 s after restart");
            facts.put("beforePoke", Map.of("turns", jdbc.queryForList(
                    "SELECT session_id, turn_id, status, error_code FROM"
                            + " managed_agent_turn WHERE tenant_id = ?"
                            + " ORDER BY created_at", tenant),
                    "plans", planRows(lead),
                    "childRuns", childRunSummary(lead)));
            try {
                input(lead, poke);
            } catch (Throwable refused) {
                mark("poke refused: " + refused.getMessage());
            }
            try {
                waiting().atMost(Duration.ofSeconds(150))
                        .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                            assertNoModelFailure();
                            assertThat(results).containsKey(callId);
                        });
                mark(callId + " answered after the poke");
            } catch (Throwable still) {
                mark(callId + " NOT answered 150 s after the poke");
                return;
            }
        }
        try {
            waiting().atMost(Duration.ofSeconds(240))
                    .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                        assertNoModelFailure();
                        assertThat(results).containsKey("l-final-list");
                        assertThat(runStates(lead).values())
                                .allMatch(state -> "settled".equals(state));
                    });
            mark("flow finished after restart");
        } catch (Throwable unfinished) {
            mark("flow did not finish after restart: "
                    + unfinished.getMessage());
        }
    }

    /**
     * P3c, the same interruption with the decision made in a user turn
     * (a Spring-tracked Managed Turn) instead of a notification wake turn.
     */
    @Test
    @Timeout(900)
    void p3cDecisionInUserTurnContinuationLost() throws Exception {
        probe = "P3C";
        boot(true);
        String lead = createLead("PRB_LEAD_P3C");
        waiting().atMost(Duration.ofSeconds(240))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(planRequests).containsKey(1);
                    assertThat(runStates(lead).values())
                            .allMatch(state -> "settled".equals(state));
                    assertThat(leadIdle(lead)).isTrue();
                });
        input(lead, "PRB_LEAD_P3C_DECIDE");
        waitForHeld(240);
        facts.put("atHold", Map.of("plans", planRows(lead),
                "childRuns", childRunSummary(lead), "turns", turns(lead)));
        restartHarness("on");
        afterRestart(lead, "l-approve", "PRB_LEAD_P3C_POKE");
        mark("P3c observed");
        closeAndSettle(lead);
    }

    /**
     * P3U, the control without any plan in a user turn: the lead's
     * send_message continuation of a completed member is held at its
     * continueChildRun commit, then the Harness restarts.
     */
    @Test
    @Timeout(900)
    void p3uUserTurnContinuationLost() throws Exception {
        probe = "P3U";
        boot(true);
        String lead = createLead("PRB_LEAD_P3U");
        waiting().atMost(Duration.ofSeconds(240))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(finals.getOrDefault("alice", List.of()))
                            .isNotEmpty();
                    assertThat(runStates(lead).values())
                            .allMatch(state -> "settled".equals(state));
                    assertThat(leadIdle(lead)).isTrue();
                });
        Thread.sleep(3000);
        input(lead, "PRB_LEAD_P3U_SEND");
        waitForHeld(240);
        facts.put("atHold", Map.of("childRuns", childRunSummary(lead),
                "turns", turns(lead)));
        restartHarness("on");
        afterRestart(lead, "l-msg", "PRB_LEAD_P3U_POKE");
        mark("P3U observed");
        closeAndSettle(lead);
    }

    /**
     * P3W, the control without any plan: a notification wake turn whose
     * send_message continuation commit is held, then the Harness restarts.
     * Run on base and head to see whether the wake-turn wedge predates
     * this PR.
     */
    @Test
    @Timeout(900)
    void p3wWakeTurnContinuationLost() throws Exception {
        probe = "P3W";
        boot(true);
        String lead = createLead("PRB_LEAD_P3W");
        waitForHeld(240);
        facts.put("atHold", Map.of("childRuns", childRunSummary(lead)));
        restartHarness("on");
        afterRestart(lead, "l-msg", "PRB_LEAD_P3W_POKE");
        mark("P3W observed");
        closeAndSettle(lead);
    }

    /**
     * P3b, a supersession whose withdrawal committed but whose new plan
     * did not: the Store proxy holds submitTeamPlan for alice's second
     * plan, the Harness is killed and restarted, and the relay's re-run
     * must open revision 2 exactly once.
     */
    @Test
    @Timeout(720)
    void p3bSupersedeSubmitLost() throws Exception {
        probe = "P3B";
        boot(true);
        String lead = createLead("PRB_LEAD_P3B");
        waitForHeld(300);
        facts.put("atHold", Map.of("plans", planRows(lead),
                "childRuns", childRunSummary(lead)));
        restartHarness("on");
        waiting().atMost(Duration.ofSeconds(420))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("l-final-list");
                    assertThat(runStates(lead).values())
                            .allMatch(state -> !"running".equals(state)
                                    && !"admitted".equals(state));
                });
        mark("P3b settled");
        closeAndSettle(lead);
    }

    /**
     * P4, rollback to the PR as shipped (team_plan disabled) with a plan
     * waiting, then reenablement: the waiting plan stays readable, a
     * completed member's shutdown refuses before effects, a lead message
     * keeps alice read-only without naming exit_plan_mode; after the
     * test-enabled build returns, the same plan is approved and alice
     * edits.
     */
    @Test
    @Timeout(780)
    void p4RollbackGateOffThenReenable() throws Exception {
        probe = "P4";
        boot(true);
        String lead = createLead("PRB_LEAD_P4");
        waiting().atMost(Duration.ofSeconds(240))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(flags).contains("p4-waiting");
                    assertThat(runStates(lead).values())
                            .allMatch(state -> "settled".equals(state));
                    assertThat(leadIdle(lead)).isTrue();
                });
        facts.put("beforeRollback.plans", planRows(lead));
        restartHarness("off");
        input(lead, "PRB_LEAD_P4_ROLLBACK");
        waiting().atMost(Duration.ofSeconds(240))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(flags).contains("p4-rollback-done");
                    assertThat(runStates(lead).values())
                            .allMatch(state -> "settled".equals(state));
                    assertThat(leadIdle(lead)).isTrue();
                });
        facts.put("afterRollback.plans", planRows(lead));
        restartHarness("on");
        input(lead, "PRB_LEAD_P4_REENABLE");
        waiting().atMost(Duration.ofSeconds(240))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("l-final-list");
                    assertThat(runStates(lead).values())
                            .allMatch(state -> "settled".equals(state));
                });
        mark("P4 settled");
        closeAndSettle(lead);
    }

    /**
     * P5, team deletion while team_plan is disabled: deletion stays
     * available and cannot withdraw, so the plan remains waiting; once the
     * test-enabled build returns, deciding it refuses (team inactive).
     */
    @Test
    @Timeout(720)
    void p5DeleteGateOff() throws Exception {
        probe = "P5";
        boot(true);
        String lead = createLead("PRB_LEAD_P5");
        waiting().atMost(Duration.ofSeconds(240))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(flags).contains("p5-waiting");
                    assertThat(runStates(lead).values())
                            .allMatch(state -> "settled".equals(state));
                    assertThat(leadIdle(lead)).isTrue();
                });
        restartHarness("off");
        input(lead, "PRB_LEAD_P5_DELETE");
        waiting().atMost(Duration.ofSeconds(180))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("l-del-list");
                    assertThat(leadIdle(lead)).isTrue();
                });
        facts.put("afterDelete.plans", planRows(lead));
        restartHarness("on");
        input(lead, "PRB_LEAD_P5_AFTER");
        waiting().atMost(Duration.ofSeconds(180))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("l-after-approve");
                    assertThat(leadIdle(lead)).isTrue();
                });
        mark("P5 settled");
        closeAndSettle(lead);
    }

    /**
     * P6, a committed submission replayed with team_plan disabled: the
     * Store proxy holds the lead's receipt commit after submitTeamPlan
     * committed; the Harness is killed and the shipped (gate-off) build
     * starts. The relay's re-run must return the original answer.
     */
    @Test
    @Timeout(720)
    void p6ReplayCommittedSubmissionGateOff() throws Exception {
        probe = "P6";
        boot(true);
        String lead = createLead("PRB_LEAD_P6");
        waitForHeld(240);
        facts.put("atHold", Map.of("plans", planRows(lead),
                "childRuns", childRunSummary(lead)));
        restartHarness("off");
        waiting().atMost(Duration.ofSeconds(360))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("a1-submit");
                    assertThat(runStates(lead).values())
                            .allMatch(state -> "settled".equals(state));
                    assertThat(leadIdle(lead)).isTrue();
                });
        mark("P6 settled");
        closeAndSettle(lead);
    }

    /**
     * P7, rollback of the Harness below this PR (the merge base, main
     * without b3d) after the lead committed a team_plan: what reopening
     * the lead does there.
     */
    @Test
    @Timeout(600)
    void p7RollbackToBase() throws Exception {
        probe = "P7";
        boot(true);
        String lead = createLead("PRB_LEAD_P7");
        waiting().atMost(Duration.ofSeconds(240))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(flags).contains("p7-waiting");
                    assertThat(runStates(lead).values())
                            .allMatch(state -> "settled".equals(state));
                    assertThat(leadIdle(lead)).isTrue();
                });
        restartHarness("base");
        input(lead, "PRB_LEAD_P7_BASE");
        try {
            waiting().atMost(Duration.ofSeconds(180))
                    .pollInterval(Duration.ofSeconds(2)).untilAsserted(() -> {
                        assertNoModelFailure();
                        List<Map<String, Object>> turns = turns(lead);
                        assertThat(turns.get(turns.size() - 1).get("status"))
                                .isIn("COMPLETED", "FAILED", "CANCELLED");
                    });
        } catch (Throwable timeout) {
            mark("P7 base turn did not finish: " + timeout.getMessage());
        }
        facts.put("baseTurns", turns(lead));
        mark("P7 observed");
        closeAndSettle(lead);
    }

    // ------------------------------------------------------------ the model

    private void modelReply(HttpExchange exchange) throws IOException {
        try {
            JsonNode body = json.readTree(exchange.getRequestBody());
            recordResults(body);
            String first = firstUserText(body);
            String name = null;
            Matcher member = MEMBER.matcher(first);
            if (member.find()) {
                name = member.group(1);
            } else if (!LEAD.matcher(first).find()) {
                Matcher preamble = TEAM_MEMBER.matcher(instruction(body));
                if (preamble.find()) name = preamble.group(1);
            }
            if (name != null) {
                String instruction = instruction(body);
                String tag = runTag(instruction);
                recordMemberRun(name, tag, instruction, body);
                Step step = memberPlan(name, tag, body);
                if (step.calls().isEmpty())
                    finals.computeIfAbsent(name,
                            key -> new CopyOnWriteArrayList<>())
                            .add(tag + ": " + step.text());
                reply(exchange, step);
                return;
            }
            Matcher lead = LEAD.matcher(first);
            if (lead.find()) {
                recordPlanRequests(body);
                Map<String, Object> seen = new LinkedHashMap<>();
                seen.put("atSec", (System.currentTimeMillis() - started)
                        / 1000.0);
                seen.put("harness", harnessBuild);
                seen.put("lastRole", lastRole(body));
                String last = withoutReminders(lastUserText(body));
                seen.put("lastUser", last.substring(0,
                        Math.min(1800, last.length())));
                Step step = leadPlan(body);
                seen.put("reply", step.calls().isEmpty() ? step.text()
                        : step.calls().get(0).get("id"));
                leadRequests.add(seen);
                leadTools.putIfAbsent(harnessBuild + ":" + leadPhase(body),
                        toolNames(body));
                reply(exchange, step);
                return;
            }
            throw new AssertionError("Unknown model request: " + first
                    .substring(0, Math.min(400, first.length())));
        } catch (IOException broken) {
            mark("model connection closed by the Harness: " + broken);
        } catch (Exception | AssertionError failure) {
            mark("MODEL FIXTURE FAILURE: " + failure);
            modelFailure.compareAndSet(null, failure);
            try {
                reply(exchange, List.of(), "");
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
                                Math.min(260, text.length())));
            }
        }
    }

    private void recordPlanRequests(JsonNode body) {
        for (JsonNode message : body.path("messages")) {
            if (!"user".equals(message.path("role").asText())) continue;
            Matcher found = PLAN_REQUEST.matcher(userText(message));
            while (found.find()) {
                int revision = Integer.parseInt(found.group(2));
                if (planRequests.putIfAbsent(revision, found.group(1)) == null)
                    mark("lead saw plan request revision " + revision + ": "
                            + found.group(1));
            }
        }
    }

    private void recordMemberRun(String name, String tag, String instruction,
            JsonNode body) {
        memberRuns.computeIfAbsent(name + "#" + tag + "@" + harnessBuild,
                key -> {
                    Map<String, Object> run = new LinkedHashMap<>();
                    run.put("atSec", (System.currentTimeMillis() - started)
                            / 1000.0);
                    run.put("harness", harnessBuild);
                    run.put("tools", toolNames(body));
                    run.put("planModeAttribute",
                            instruction.contains("plan-mode=\"required\""));
                    run.put("namesExitPlanMode",
                            instruction.contains("exit_plan_mode"));
                    run.put("instruction", instruction.substring(0,
                            Math.min(2400, instruction.length())));
                    run.put("originalTaskInHistory", withoutReminders(
                            lastUserText(body)).contains("PRB_MEMBER_"
                                    + name + "_GO"));
                    run.put("inputBytes", withoutReminders(lastUserText(body))
                            .getBytes(StandardCharsets.UTF_8).length);
                    run.put("instructionBytes", instruction
                            .getBytes(StandardCharsets.UTF_8).length);
                    mark(name + " run " + tag + " starts on " + harnessBuild
                            + ": tools=" + run.get("tools") + " planMode="
                            + run.get("planModeAttribute"));
                    return run;
                });
    }

    /** The run's own instruction: after the last continuation marker. */
    private static String instruction(JsonNode body) {
        String last = withoutReminders(lastUserText(body));
        int at = last.lastIndexOf(MARKER);
        return at < 0 ? last : last.substring(at + MARKER.length()).strip();
    }

    private static String runTag(String instruction) {
        if (instruction.contains("Your plan was approved")) return "approved";
        if (instruction.contains("Your plan was rejected")) return "rejected";
        Matcher note = Pattern.compile("PRB_LEAD_NOTE_([A-Z0-9]+)")
                .matcher(instruction);
        if (note.find()) return "note-" + note.group(1);
        if (instruction.contains("PRB_RESEND")) return "resend";
        return "first";
    }

    private String leadPhase(JsonNode body) {
        String last = lastUserText(body);
        Matcher phase = Pattern.compile("PRB_LEAD_P[0-9A-Z]+_([A-Z]+)")
                .matcher(last);
        return phase.find() ? phase.group(1) : "main";
    }

    // ------------------------------------------------------------ the lead

    private Step leadPlan(JsonNode body) {
        Set<String> issued = issuedCallIds(body);
        String all = allUserText(body);
        String last = lastUserText(body);
        boolean fresh = "user".equals(lastRole(body));
        if (!issued.contains("l-create"))
            return one("l-create", "team_create", Map.of("team_name",
                    "review"));
        return switch (probe) {
            case "P1" -> p1Lead(issued, all);
            case "P2" -> p2Lead(issued, all);
            case "P3A" -> p3aLead(issued, all);
            case "P3C" -> all.contains("PRB_LEAD_P3C_DECIDE")
                    ? p3aLead(issued, all)
                    : launchThenIdle(issued, List.of(launch("alice", true)));
            case "P3W" -> p3wLead(issued, all);
            case "P3U" -> p3uLead(issued, all);
            case "P3B" -> p3bLead(issued, all);
            case "P4" -> p4Lead(issued, all, last, fresh);
            case "P5" -> p5Lead(issued, all, last, fresh);
            case "P6" -> launchThenIdle(issued, List.of(launch("alice",
                    true)));
            case "P7" -> p7Lead(issued, last, fresh);
            default -> throw new AssertionError("no probe " + probe);
        };
    }

    private Step launchThenIdle(Set<String> issued,
            List<Map<String, Object>> launches) {
        if (!issued.contains(launches.get(0).get("id").toString()))
            return new Step(launches, null);
        return new Step(List.of(), "LEAD_IDLE");
    }

    private static Map<String, Object> launch(String name, boolean plan) {
        Map<String, Object> args = new LinkedHashMap<>();
        args.put("description", name + " task");
        args.put("prompt", "PRB_MEMBER_" + name + "_GO audit README.md");
        args.put("name", name);
        if (plan) args.put("plan_mode_required", true);
        return call("l-launch-" + name, "agent", args);
    }

    private static Map<String, Object> decide(String id, String request,
            String action, String message) {
        Map<String, Object> args = new LinkedHashMap<>();
        args.put("request_id", request);
        args.put("action", action);
        if (message != null) args.put("message", message);
        return call(id, "team_plan_approval", args);
    }

    private Step p1Lead(Set<String> issued, String all) {
        if (!issued.contains("l-launch-alice"))
            return new Step(List.of(launch("alice", true),
                    launch("bob", false)), null);
        String r1 = planRequests.get(1);
        String r2 = planRequests.get(2);
        if (r1 != null && !issued.contains("l-show-1"))
            return new Step(List.of(decide("l-show-1", r1, "show", null)),
                    null);
        if (issued.contains("l-show-1") && !issued.contains("l-reject-1"))
            return new Step(List.of(decide("l-reject-1", r1, "reject",
                    "PRB_FEEDBACK add a rollback step")), null);
        if (r2 != null && !issued.contains("l-list-2"))
            return one("l-list-2", "task_list", Map.of());
        if (issued.contains("l-list-2") && !issued.contains("l-note"))
            return one("l-note", "send_message", Map.of("to", "alice",
                    "message", "PRB_LEAD_NOTE_P1 keep an audit log too"));
        if (issued.contains("l-note") && !issued.contains("l-early"))
            return new Step(List.of(decide("l-early", r2, "approve", null)),
                    null);
        if (issued.contains("l-early") && all.contains("ALICE_NOTED")
                && !issued.contains("l-approve-2"))
            return new Step(List.of(decide("l-approve-2", r2, "approve",
                    "PRB_APPROVE_MSG go ahead")), null);
        if (issued.contains("l-approve-2") && all.contains("ALICE_DONE")
                && !issued.contains("l-final-list"))
            return one("l-final-list", "task_list", Map.of());
        return new Step(List.of(), "LEAD_IDLE");
    }

    private Step p2Lead(Set<String> issued, String all) {
        if (!issued.contains("l-bad-launch")) {
            Map<String, Object> args = new LinkedHashMap<>();
            args.put("description", "zed task");
            args.put("prompt", "PRB_MEMBER_zed_GO");
            args.put("name", "zed");
            args.put("plan_mode_required", "yes");
            return one("l-bad-launch", "agent", args);
        }
        if (!issued.contains("l-unnamed")) {
            Map<String, Object> args = new LinkedHashMap<>();
            args.put("description", "unnamed task");
            args.put("prompt", "PRB_MEMBER_unnamed_GO");
            args.put("plan_mode_required", true);
            return one("l-unnamed", "agent", args);
        }
        if (!issued.contains("l-launch-alice"))
            return new Step(List.of(launch("alice", true),
                    launch("carol", false)), null);
        String r1 = planRequests.get(1);
        String r2 = planRequests.get(2);
        String r3 = planRequests.get(3);
        if (r1 != null) {
            if (!issued.contains("l-bogus"))
                return new Step(List.of(decide("l-bogus", "cmd_bogus",
                        "approve", null)), null);
            if (!issued.contains("l-badaction"))
                return new Step(List.of(decide("l-badaction", r1, "maybe",
                        null)), null);
            if (!issued.contains("l-bigmsg"))
                return new Step(List.of(decide("l-bigmsg", r1, "reject",
                        "x".repeat(4097))), null);
            if (!issued.contains("l-reject-max"))
                return new Step(List.of(decide("l-reject-max", r1, "reject",
                        "\"".repeat(4096))), null);
        }
        if (r2 != null) {
            if (!issued.contains("l-old"))
                return new Step(List.of(decide("l-old", r1, "approve",
                        null)), null);
            if (!issued.contains("l-note"))
                return one("l-note", "send_message", Map.of("to", "alice",
                        "message", "PRB_LEAD_NOTE_P2 also cover the log"));
        }
        if (r3 != null) {
            if (!issued.contains("l-stale"))
                return new Step(List.of(decide("l-stale", r2, "approve",
                        null)), null);
            if (!issued.contains("l-approve-3"))
                return new Step(List.of(decide("l-approve-3", r3, "approve",
                        null)), null);
            if (!issued.contains("l-again-3"))
                return new Step(List.of(decide("l-again-3", r3, "approve",
                        null)), null);
        }
        if (all.contains("ALICE_DONE") && !issued.contains("l-final-list"))
            return one("l-final-list", "task_list", Map.of());
        return new Step(List.of(), "LEAD_IDLE");
    }

    private Step p3aLead(Set<String> issued, String all) {
        if (!issued.contains("l-launch-alice"))
            return new Step(List.of(launch("alice", true)), null);
        String r1 = planRequests.get(1);
        if (r1 != null && !issued.contains("l-approve")) {
            arm("continueChildRun");
            return new Step(List.of(decide("l-approve", r1, "approve",
                    "PRB_APPROVE_MSG go")), null);
        }
        if (issued.contains("l-approve") && results.containsKey("l-approve")
                && !issued.contains("l-again")) {
            // A second decision call on the same plan: never a second
            // continuation, never a claim of delivery.
            return new Step(List.of(decide("l-again", r1, "approve", null)),
                    null);
        }
        if (issued.contains("l-again") && !issued.contains("l-show"))
            return new Step(List.of(decide("l-show", r1, "show", null)), null);
        if (issued.contains("l-show") && !issued.contains("l-resend"))
            return one("l-resend", "send_message", Map.of("to", "alice",
                    "message", "PRB_RESEND the leader approved your plan earlier;"
                            + " carry it out: " + PLAN_V1));
        if (issued.contains("l-resend") && all.contains("ALICE_DONE")
                && !issued.contains("l-final-list"))
            return one("l-final-list", "task_list", Map.of());
        return new Step(List.of(), "LEAD_IDLE");
    }

    private Step p3uLead(Set<String> issued, String all) {
        if (!issued.contains("l-launch-alice"))
            return new Step(List.of(launch("alice", false)), null);
        if (all.contains("PRB_LEAD_P3U_SEND") && !issued.contains("l-msg"))
            return sendHeld();
        if (all.contains("ALICE_W2") && !issued.contains("l-final-list"))
            return one("l-final-list", "task_list", Map.of());
        return new Step(List.of(), "LEAD_IDLE");
    }

    private Step sendHeld() {
        arm("continueChildRun");
        return one("l-msg", "send_message", Map.of("to", "alice",
                "message", "PRB_LEAD_NOTE_W one more thing"));
    }

    private Step p3wLead(Set<String> issued, String all) {
        if (!issued.contains("l-launch-alice"))
            return new Step(List.of(launch("alice", false)), null);
        if (all.contains("ALICE_W1") && !issued.contains("l-msg")) {
            arm("continueChildRun");
            return one("l-msg", "send_message", Map.of("to", "alice",
                    "message", "PRB_LEAD_NOTE_W one more thing"));
        }
        if (all.contains("ALICE_W2") && !issued.contains("l-final-list"))
            return one("l-final-list", "task_list", Map.of());
        return new Step(List.of(), "LEAD_IDLE");
    }

    private Step p3bLead(Set<String> issued, String all) {
        if (!issued.contains("l-launch-alice"))
            return new Step(List.of(launch("alice", true)), null);
        String r1 = planRequests.get(1);
        String r2 = planRequests.get(2);
        if (r1 != null && !issued.contains("l-note")) {
            arm("submitTeamPlan");
            return one("l-note", "send_message", Map.of("to", "alice",
                    "message", "PRB_LEAD_NOTE_P3B please revise the plan"));
        }
        if (r2 != null && !issued.contains("l-stale"))
            return new Step(List.of(decide("l-stale", r1, "approve", null)),
                    null);
        if (r2 != null && !issued.contains("l-approve-2"))
            return new Step(List.of(decide("l-approve-2", r2, "approve",
                    null)), null);
        if (all.contains("ALICE_DONE") && !issued.contains("l-final-list"))
            return one("l-final-list", "task_list", Map.of());
        return new Step(List.of(), "LEAD_IDLE");
    }

    private Step p4Lead(Set<String> issued, String all, String last,
            boolean fresh) {
        if (!issued.contains("l-launch-alice"))
            return new Step(List.of(launch("alice", true)), null);
        String r1 = planRequests.get(1);
        if (r1 != null) flags.add("p4-waiting");
        if (all.contains("PRB_LEAD_P4_ROLLBACK")) {
            if (!issued.contains("l-rb-list"))
                return one("l-rb-list", "task_list", Map.of());
            if (!issued.contains("l-rb-shutdown"))
                return one("l-rb-shutdown", "request_shutdown",
                        Map.of("to", "alice"));
            if (!issued.contains("l-rb-note"))
                return one("l-rb-note", "send_message", Map.of("to", "alice",
                        "message", "PRB_LEAD_NOTE_RB status please"));
            if (all.contains("ALICE_RB_NOTED")
                    && !all.contains("PRB_LEAD_P4_REENABLE"))
                flags.add("p4-rollback-done");
        }
        if (all.contains("PRB_LEAD_P4_REENABLE")) {
            if (!issued.contains("l-re-list"))
                return one("l-re-list", "task_list", Map.of());
            if (!issued.contains("l-re-approve"))
                return new Step(List.of(decide("l-re-approve", r1, "approve",
                        "PRB_APPROVE_MSG after reenablement")), null);
            if (all.contains("ALICE_DONE")
                    && !issued.contains("l-final-list"))
                return one("l-final-list", "task_list", Map.of());
        }
        return new Step(List.of(), "LEAD_IDLE");
    }

    private Step p5Lead(Set<String> issued, String all, String last,
            boolean fresh) {
        if (!issued.contains("l-launch-alice"))
            return new Step(List.of(launch("alice", true)), null);
        if (planRequests.get(1) != null) flags.add("p5-waiting");
        if (all.contains("PRB_LEAD_P5_DELETE")) {
            if (!issued.contains("l-del"))
                return one("l-del", "team_delete", Map.of());
            if (!issued.contains("l-del-list"))
                return one("l-del-list", "task_list", Map.of());
        }
        if (all.contains("PRB_LEAD_P5_AFTER")
                && !issued.contains("l-after-approve"))
            return new Step(List.of(decide("l-after-approve",
                    planRequests.get(1), "approve", null)), null);
        return new Step(List.of(), "LEAD_IDLE");
    }

    private Step p7Lead(Set<String> issued, String last, boolean fresh) {
        if (!issued.contains("l-launch-alice"))
            return new Step(List.of(launch("alice", true)), null);
        if (planRequests.get(1) != null) flags.add("p7-waiting");
        if (last.contains("PRB_LEAD_P7_BASE") && !issued.contains("l-base-list"))
            return one("l-base-list", "task_list", Map.of());
        return new Step(List.of(), "LEAD_IDLE");
    }

    // ------------------------------------------------------------ members

    private Step memberPlan(String name, String tag, JsonNode body) {
        Set<String> issued = issuedCallIds(body);
        if (!List.of("alice", "bob", "carol").contains(name))
            return new Step(List.of(), name.toUpperCase() + "_DONE");
        if (name.equals("bob"))
            return seq(issued, List.of(call("b1-write", "write_file",
                    Map.of("file_path", "bob.md", "content",
                            "PRB bob was never in plan mode\n"))),
                    "BOB_DONE");
        if (name.equals("carol"))
            return new Step(List.of(), "CAROL_DONE");
        return switch (probe) {
            case "P1" -> p1Alice(tag, issued);
            case "P2" -> p2Alice(tag, issued);
            case "P3W", "P3U" -> new Step(List.of(), tag.equals("first")
                    ? "ALICE_W1" : "ALICE_W2");
            case "P3A", "P3C" -> switch (tag) {
                case "first" -> seq(issued, List.of(submit("a1-submit",
                        PLAN_V1)), "ALICE_V1_SUBMITTED");
                default -> seq(issued, List.of(call("a2-write", "write_file",
                        Map.of("file_path", "plan-output.md", "content",
                                "PRB_IMPLEMENTED " + tag + "\n"))),
                        "ALICE_DONE");
            };
            case "P3B" -> switch (tag) {
                case "first" -> seq(issued, List.of(submit("a1-submit",
                        PLAN_V1)), "ALICE_V1_SUBMITTED");
                case "note-P3B" -> seq(issued, List.of(submit("a2-submit",
                        PLAN_V2)), "ALICE_V2_SUBMITTED");
                case "approved" -> seq(issued, List.of(call("a3-write",
                        "write_file", Map.of("file_path", "plan-output.md",
                                "content", "PRB_IMPLEMENTED V2\n"))),
                        "ALICE_DONE");
                default -> new Step(List.of(), "ALICE_UNEXPECTED_" + tag);
            };
            case "P4" -> switch (tag) {
                case "first" -> seq(issued, List.of(submit("a1-submit",
                        PLAN_V1)), "ALICE_V1_SUBMITTED");
                case "note-RB" -> seq(issued, List.of(call("a-rb-write",
                        "write_file", Map.of("file_path", "blocked-rb.md",
                                "content", "must be refused\n"))),
                        "ALICE_RB_NOTED");
                case "approved" -> seq(issued, List.of(call("a3-write",
                        "write_file", Map.of("file_path", "plan-output.md",
                                "content", "PRB_IMPLEMENTED after"
                                        + " reenablement\n"))),
                        "ALICE_DONE");
                default -> new Step(List.of(), "ALICE_UNEXPECTED_" + tag);
            };
            case "P5", "P7" -> seq(issued, List.of(submit("a1-submit",
                    PLAN_V1)), "ALICE_V1_SUBMITTED");
            case "P6" -> {
                if (!issued.contains("a1-submit"))
                    arm("commitSessionCommandReceipt");
                yield seq(issued, List.of(submit("a1-submit", PLAN_V1)),
                        "ALICE_V1_SUBMITTED");
            }
            default -> throw new AssertionError("no probe " + probe);
        };
    }

    private Step p1Alice(String tag, Set<String> issued) {
        return switch (tag) {
            case "first" -> seq(issued, List.of(
                    call("a1-read", "read_file", Map.of("file_path",
                            "README.md")),
                    call("a1-write", "write_file", Map.of("file_path",
                            "blocked-1.md", "content", "must be refused\n")),
                    call("a1-list", "task_list", Map.of()),
                    submit("a1-submit", PLAN_V1)), "ALICE_V1_SUBMITTED");
            case "rejected" -> seq(issued, List.of(
                    call("a2-write", "write_file", Map.of("file_path",
                            "blocked-2.md", "content", "must be refused\n")),
                    submit("a2-submit", PLAN_V2)), "ALICE_V2_SUBMITTED");
            case "note-P1" -> {
                if (!issued.contains("a3-write"))
                    holdUntil(() -> results.containsKey("l-early"), 150,
                            "alice's note run holds until the lead's early"
                                    + " approval was answered");
                yield seq(issued, List.of(call("a3-write", "write_file",
                        Map.of("file_path", "blocked-3.md", "content",
                                "must be refused\n"))), "ALICE_NOTED");
            }
            case "approved" -> seq(issued, List.of(
                    call("a4-write", "write_file", Map.of("file_path",
                            "plan-output.md", "content",
                            "PRB_IMPLEMENTED per PLAN_V2\n")),
                    call("a4-read", "read_file", Map.of("file_path",
                            "plan-output.md"))), "ALICE_DONE");
            default -> new Step(List.of(), "ALICE_UNEXPECTED_" + tag);
        };
    }

    private Step p2Alice(String tag, Set<String> issued) {
        return switch (tag) {
            case "first" -> seq(issued, List.of(
                    submit("a1-empty", "   "),
                    call("a1-msg", "send_message", Map.of("to", "carol",
                            "message", "PRB_PEER hello carol")),
                    submit("a1-big", "B".repeat(Integer.getInteger(
                            "probe.bigPlan", 12000))),
                    submit("a1-ok", System.getProperty("probe.okPlan",
                            PLAN_V1)),
                    submit("a1-again", "PLAN_DUPLICATE")), "ALICE_V1");
            case "rejected" -> seq(issued, List.of(
                    submit("a2-submit", PLAN_V2)), "ALICE_V2");
            case "note-P2" -> seq(issued, List.of(
                    submit("a3-submit", PLAN_V3)), "ALICE_V3");
            case "approved" -> seq(issued, List.of(
                    call("a4-write", "write_file", Map.of("file_path",
                            "plan-output.md", "content",
                            "PRB_IMPLEMENTED per PLAN_V3\n"))), "ALICE_DONE");
            default -> new Step(List.of(), "ALICE_UNEXPECTED_" + tag);
        };
    }

    private static Map<String, Object> submit(String id, String plan) {
        return call(id, "exit_plan_mode", Map.of("plan", plan));
    }

    private static Step seq(Set<String> issued,
            List<Map<String, Object>> calls, String text) {
        for (Map<String, Object> step : calls)
            if (!issued.contains(step.get("id").toString()))
                return new Step(List.of(step), null);
        return new Step(List.of(), text);
    }

    private void holdUntil(BooleanSupplier condition, int seconds,
            String label) {
        long deadline = System.currentTimeMillis() + seconds * 1000L;
        mark("hold: " + label);
        while (System.currentTimeMillis() < deadline) {
            try {
                if (condition.getAsBoolean()) {
                    mark("hold released: " + label);
                    return;
                }
            } catch (RuntimeException ignored) {
            }
            try {
                Thread.sleep(250);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        mark("hold TIMED OUT: " + label);
    }

    private static Step one(String id, String tool, Map<String, Object> args) {
        return new Step(List.of(call(id, tool, args)), null);
    }

    private record Step(List<Map<String, Object>> calls, String text) {
    }

    // ------------------------------------------------------------ faults

    private void arm(String operation) {
        try {
            Path file = temporary.resolve("ctl/hold-commit");
            if (!flags.contains("armed:" + operation)) {
                Files.writeString(file, operation + "\n");
                flags.add("armed:" + operation);
                mark("store proxy armed to hold " + operation);
            }
        } catch (IOException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private void waitForHeld(int seconds) throws IOException {
        waiting().atMost(Duration.ofSeconds(seconds))
                .pollInterval(Duration.ofMillis(300)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(storeLog()).anyMatch(entry ->
                            "held".equals(entry.path("action").asText()));
                });
        JsonNode held = storeLog().stream().filter(entry ->
                "held".equals(entry.path("action").asText()))
                .findFirst().orElseThrow();
        mark("store proxy holds " + held.path("operation").asText() + " "
                + held.path("commandId").asText() + " on "
                + held.path("session").asText());
        facts.put("heldCommit", held);
    }

    private void restartHarness(String build) throws Exception {
        killHarness(true);
        mark("Harness killed (" + harnessBuild + ")");
        Files.deleteIfExists(temporary.resolve("ctl/hold-commit"));
        harnessBuild = build;
        startHarness();
        mark("Harness started (" + build + ")");
    }

    private void killHarness(boolean forcibly) throws InterruptedException {
        if (harness == null) return;
        if (forcibly) {
            harness.descendants().forEach(ProcessHandle::destroyForcibly);
            harness.destroyForcibly();
        } else {
            harness.descendants().forEach(ProcessHandle::destroy);
            harness.destroy();
        }
        harness.waitFor(20, TimeUnit.SECONDS);
    }

    private List<JsonNode> storeLog() throws IOException {
        Path log = temporary.resolve("store.jsonl");
        List<JsonNode> out = new ArrayList<>();
        if (!Files.exists(log)) return out;
        for (String line : Files.readAllLines(log))
            out.add(json.readTree(line));
        return out;
    }

    // ------------------------------------------------------------ evidence

    private void mark(String what) {
        String line = String.format("+%6.1fs %s",
                (System.currentTimeMillis() - started) / 1000.0, what);
        timeline.add(line);
        System.out.println("[probe] " + line);
    }

    private void dumpEvidence(String test) throws Exception {
        if (jdbc == null) return;
        Path out = Path.of(System.getProperty("probe.out",
                "target/pr13974-probe"));
        Files.createDirectories(out);
        Map<String, Object> evidence = new LinkedHashMap<>();
        evidence.put("test", test);
        evidence.put("tenant", tenant);
        evidence.put("lead", leadSession);
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
        evidence.put("finals", finals);
        evidence.put("flags", flags);
        evidence.put("facts", facts);
        evidence.put("planRequests", planRequests);
        evidence.put("memberRuns", new java.util.TreeMap<>(memberRuns));
        evidence.put("leadTools", leadTools);
        evidence.put("leadRequests", leadRequests);
        if (leadSession != null) {
            safe(evidence, "plans", () -> planRows(leadSession));
            safe(evidence, "team", () -> rows(leadSession, "team_state").stream()
                    .map(this::body).toList());
            safe(evidence, "childRuns", () -> childRunSummary(leadSession));
            safe(evidence, "runStates", () -> runStates(leadSession));
            safe(evidence, "leadReceipts", () -> commandsWithReplies(leadSession));
            safe(evidence, "leadTurns", () -> turns(leadSession));
            safe(evidence, "leadJournalOps", () -> jdbc.queryForList(
                    "SELECT operation, COUNT(*) AS n FROM"
                            + " qwen_managed_session_journal_tx WHERE"
                            + " tenant_id = ? AND session_id = ? GROUP BY"
                            + " operation ORDER BY operation", tenant,
                    leadSession));
            safe(evidence, "leadPlanJournal", () -> jdbc.queryForList(
                    "SELECT journal_revision, operation, command_id, writer_generation FROM"
                            + " qwen_managed_session_journal_tx WHERE"
                            + " tenant_id = ? AND session_id = ? AND"
                            + " (operation LIKE '%Plan%' OR operation ="
                            + " 'continueChildRun' OR operation LIKE"
                            + " '%SessionCommand%') ORDER BY journal_revision", tenant, leadSession));
            Map<String, Object> members = new LinkedHashMap<>();
            for (Map<String, Object> run : childRunSummary(leadSession)) {
                Object session = run.get("childSessionId");
                if (session == null) continue;
                Map<String, Object> view = new LinkedHashMap<>();
                view.put("childRunId", run.get("childRunId"));
                view.put("commands", commandsWithReplies(session.toString()));
                view.put("turns", turns(session.toString()));
                members.put(session.toString(), view);
            }
            safe(evidence, "memberSessions", () -> members);
            safe(evidence, "allTurns", () -> jdbc.queryForList(
                    "SELECT session_id, turn_id, status, error_code FROM"
                            + " managed_agent_turn WHERE tenant_id = ?"
                            + " ORDER BY created_at", tenant));
        }
        Map<String, Object> files = new LinkedHashMap<>();
        if (workspaceDir != null) {
            try (var listing = Files.list(workspaceDir)) {
                for (Path file : listing.sorted().toList())
                    files.put(file.getFileName().toString(),
                            Files.isRegularFile(file)
                                    ? Files.readString(file) : "<dir>");
            }
        }
        evidence.put("workspaceFiles", files);
        for (String name : List.of("proxy.jsonl", "store.jsonl")) {
            Path log = temporary.resolve(name);
            if (!Files.exists(log)) continue;
            List<Object> ops = new ArrayList<>();
            for (String line : Files.readAllLines(log)) {
                JsonNode entry = json.readTree(line);
                if (name.equals("store.jsonl")
                        && !entry.path("operation").asText().matches(
                                ".*(Plan|ChildRun|SessionCommand).*"))
                    continue;
                ops.add(entry);
            }
            evidence.put(name, ops);
        }
        List<String> harnessLines = new ArrayList<>();
        try (var logs = Files.list(temporary)) {
            for (Path log : logs.filter(path -> Files.isRegularFile(path)
                    && path.getFileName().toString().startsWith("harness-")
                    && path.getFileName().toString().endsWith(".log"))
                    .sorted().toList()) {
                harnessLines.add("== " + log.getFileName());
                for (String line : Files.readAllLines(log)) {
                    if (line.contains("qwen serve") || line.contains("rror")
                            || line.contains("nsupported"))
                        harnessLines.add(line.substring(0,
                                Math.min(700, line.length())));
                }
            }
        }
        evidence.put("harnessLogLines", harnessLines);
        Files.writeString(out.resolve(test + ".json"),
                json.writeValueAsString(evidence));
        System.out.println("[probe] evidence -> " + out.resolve(test + ".json"));
    }

    private void safe(Map<String, Object> evidence, String key,
            java.util.concurrent.Callable<Object> value) {
        try {
            evidence.put(key, value.call());
        } catch (Exception failure) {
            evidence.put(key, "evidence failed: " + failure);
        }
    }

    private List<Map<String, Object>> planRows(String lead) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : rows(lead, "team_plan")) {
            JsonNode plan = body(row);
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("requestId", row.get("record_id"));
            view.put("revision", row.get("revision"));
            view.put("member", plan.path("member").asText());
            view.put("planRevision", plan.path("planRevision").asInt());
            view.put("state", plan.at("/run/state").asText());
            view.put("decision", plan.path("decision").isNull() ? null
                    : plan.path("decision").asText());
            String text = resourceText(lead,
                    plan.at("/planRef/resourceId").asText());
            view.put("planHead", text == null ? null
                    : text.substring(0, Math.min(120, text.length())));
            view.put("planBytes", plan.at("/planRef/byteLength").asLong());
            String feedback = plan.path("feedbackRef").isNull() ? null
                    : resourceText(lead,
                            plan.at("/feedbackRef/resourceId").asText());
            view.put("feedbackHead", feedback == null ? null
                    : feedback.substring(0, Math.min(60, feedback.length())));
            view.put("feedbackBytes", feedback == null ? 0
                    : feedback.getBytes(StandardCharsets.UTF_8).length);
            out.add(view);
        }
        return out;
    }

    private List<Map<String, Object>> childRunSummary(String lead) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : latestRows(lead, "child_run")) {
            JsonNode run = body(row);
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("childRunId", row.get("record_id"));
            view.put("revision", row.get("revision"));
            view.put("state", run.at("/run/state").asText());
            view.put("execution", run.at("/run/execution").asText(null));
            view.put("predecessor", run.path("predecessorChildRunId")
                    .asText(null));
            view.put("childSessionId", run.path("childSessionId")
                    .asText(null));
            view.put("executionCallId", run.at("/run/executionCallId")
                    .asText(null));
            String input = resourceText(lead,
                    run.at("/inputRef/resourceId").asText());
            if (input != null) {
                view.put("inputBytes", input.getBytes(StandardCharsets.UTF_8)
                        .length);
                view.put("inputBase64", Base64.getEncoder().encodeToString(
                        input.getBytes(StandardCharsets.UTF_8)));
            }
            out.add(view);
        }
        return out;
    }

    private List<Map<String, Object>> commandsWithReplies(String session) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : latestRows(session, "session_command")) {
            JsonNode command = body(row);
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("commandId", row.get("record_id"));
            view.put("revision", row.get("revision"));
            view.put("kind", command.path("kind").asText());
            view.put("direction", command.path("direction").asText());
            view.put("delivery", command.at("/run/delivery/state").asText());
            String args = resourceText(session,
                    command.at("/argsRef/resourceId").asText());
            view.put("argsHead", args == null ? null
                    : args.substring(0, Math.min(160, args.length())));
            String reply = resourceText(session,
                    command.at("/replyRef/resourceId").asText());
            view.put("reply", reply);
            out.add(view);
        }
        return out;
    }

    private List<Map<String, Object>> turns(String session) {
        return jdbc.queryForList(
                "SELECT turn_id, status, error_code FROM managed_agent_turn"
                        + " WHERE tenant_id = ? AND session_id = ?"
                        + " ORDER BY created_at", tenant, session);
    }

    private boolean leadIdle(String lead) {
        List<Map<String, Object>> turns = turns(lead);
        return !turns.isEmpty() && turns.stream().allMatch(turn ->
                List.of("COMPLETED", "FAILED", "CANCELLED")
                        .contains(turn.get("status").toString()));
    }

    private String resourceText(String session, String resourceId) {
        if (resourceId == null || resourceId.isEmpty()) return null;
        List<String> found = jdbc.queryForList(
                "SELECT CAST(inline_bytes AS CHAR) FROM"
                        + " qwen_managed_session_resource WHERE tenant_id = ?"
                        + " AND session_id = ? AND resource_id = ?",
                String.class, tenant, session, resourceId);
        return found.isEmpty() ? null : found.get(0);
    }

    /** name -> the run state of the chain head (root or continuation). */
    private Map<String, String> runStates(String lead) {
        Map<String, String> out = new LinkedHashMap<>();
        if (lead == null) return out;
        JsonNode team = rows(lead, "team_state").stream().map(this::body)
                .reduce((a, b) -> b).orElse(null);
        if (team == null) return out;
        Map<String, JsonNode> runs = new LinkedHashMap<>();
        for (Map<String, Object> row : latestRows(lead, "child_run"))
            runs.put(row.get("record_id").toString(), body(row));
        for (JsonNode member : team.path("members")) {
            String head = member.path("childRunId").asText();
            boolean moved = true;
            while (moved) {
                moved = false;
                for (Map.Entry<String, JsonNode> run : runs.entrySet()) {
                    if (head.equals(run.getValue().path("predecessorChildRunId")
                            .asText(null))) {
                        head = run.getKey();
                        moved = true;
                    }
                }
            }
            JsonNode run = runs.get(head);
            out.put(member.path("name").asText(),
                    run == null ? "missing" : run.at("/run/state").asText());
        }
        return out;
    }

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
        input(leadSession, marker);
        mark("lead created " + leadSession);
        return leadSession;
    }

    private void input(String session, String text) {
        waiting().atMost(Duration.ofSeconds(120))
                .pollInterval(Duration.ofSeconds(2)).ignoreExceptions()
                .untilAsserted(() -> request("POST",
                        "/v1/agents/sessions/" + session + "/events",
                        Map.of("type", "agent.session.input.message",
                                "input",
                                List.of(Map.of("type", "input_text", "text",
                                        text))),
                        "input-" + text, 202));
        mark("input posted: " + text);
    }

    private void closeAndSettle(String lead) {
        try {
            try {
                request("POST", "/v1/agents/sessions/" + lead + "/close", null,
                        "close-" + lead, 202);
            } catch (AssertionError failure) {
                mark("close: " + String.valueOf(failure.getMessage())
                        .substring(0, Math.min(200,
                                String.valueOf(failure.getMessage()).length())));
            }
            waiting().atMost(Duration.ofSeconds(30))
                    .pollInterval(Duration.ofMillis(500)).untilAsserted(() ->
                            assertThat(jdbc.queryForList(
                                    "SELECT session_id, status FROM"
                                            + " managed_agent_turn WHERE"
                                            + " tenant_id = ? AND status NOT IN"
                                            + " ('COMPLETED', 'FAILED',"
                                            + " 'CANCELLED')", tenant))
                                    .isEmpty());
            mark("all turns terminal");
        } catch (Throwable failure) {
            mark("settle: " + failure.getMessage());
        }
    }

    // ------------------------------------------------------------- queries

    private static List<String> toolNames(JsonNode body) {
        List<String> names = new ArrayList<>();
        for (JsonNode tool : body.path("tools")) {
            String name = tool.at("/function/name").asText();
            if (name.equals("agent")) {
                JsonNode properties = tool.at("/function/parameters/properties");
                if (properties.has("plan_mode_required"))
                    name += "(+plan_mode_required)";
            }
            names.add(name);
        }
        return names;
    }

    private static String userText(JsonNode message) {
        JsonNode content = message.path("content");
        if (content.isTextual()) return content.asText();
        if (content.isArray()) {
            StringBuilder text = new StringBuilder();
            for (JsonNode part : content)
                if (part.path("text").isTextual())
                    text.append(part.path("text").asText());
            return text.toString();
        }
        return content.toString();
    }

    private static String withoutReminders(String text) {
        return text.replaceAll("(?s)<system-reminder>.*?</system-reminder>",
                "").strip();
    }

    private static String firstUserText(JsonNode body) {
        for (JsonNode message : body.path("messages")) {
            if (!"user".equals(message.path("role").asText())) continue;
            String text = userText(message);
            if (text.contains("PRB_")) return text;
        }
        return "";
    }

    private static String lastUserText(JsonNode body) {
        String last = "";
        for (JsonNode message : body.path("messages")) {
            if (!"user".equals(message.path("role").asText())) continue;
            last = userText(message);
        }
        return last;
    }

    private static String allUserText(JsonNode body) {
        StringBuilder all = new StringBuilder();
        for (JsonNode message : body.path("messages"))
            if ("user".equals(message.path("role").asText()))
                all.append(userText(message)).append('\n');
        return all.toString();
    }

    private static String lastRole(JsonNode body) {
        String role = "";
        for (JsonNode message : body.path("messages"))
            role = message.path("role").asText();
        return role;
    }

    /** The call ids the assistant already issued in this history. */
    private static Set<String> issuedCallIds(JsonNode body) {
        Set<String> ids = new LinkedHashSet<>();
        for (JsonNode message : body.path("messages")) {
            if (!"assistant".equals(message.path("role").asText())) continue;
            for (JsonNode call : message.path("tool_calls"))
                ids.add(call.path("id").asText());
        }
        return ids;
    }

    private static String plain(String text) {
        String out = text;
        for (int pass = 0; pass < 4; pass++)
            out = out.replace("\\\\", "\\").replace("\\\"", "\"")
                    .replace("\\n", "\n");
        return out;
    }

    private static Map<String, Object> call(String id, String name,
            Map<String, Object> args) {
        return Map.of("id", id, "name", name, "args", args);
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

    private List<Map<String, Object>> latestRows(String session,
            String domain) {
        Map<String, Map<String, Object>> latest = new LinkedHashMap<>();
        for (Map<String, Object> row : rows(session, domain))
            latest.put(row.get("record_id").toString(), row);
        return new ArrayList<>(latest.values());
    }

    private JsonNode body(Map<String, Object> row) {
        try {
            return json.readTree(row.get("body").toString());
        } catch (IOException failure) {
            throw new AssertionError(failure);
        }
    }

    private void assertNoModelFailure() {
        Throwable failure = modelFailure.get();
        if (failure != null) {
            throw new IllegalStateException("The model fixture failed",
                    failure);
        }
    }

    // ------------------------------------------------------------- the stack

    private Path cli(String build) {
        String property = switch (build) {
            case "on" -> "qwen.cli.entry";
            case "off" -> "qwen.cli.off";
            case "base" -> "qwen.cli.base";
            default -> throw new AssertionError(build);
        };
        String value = System.getProperty(property);
        assertThat(value).as("Pass -D" + property).isNotBlank();
        Path path = Path.of(value).toAbsolutePath();
        assertThat(path).isRegularFile();
        return path;
    }

    private void boot(boolean shortLease) throws Exception {
        Path cli = cli("on");
        String node = System.getProperty("node.executable");
        assertThat(node).isNotBlank();
        assertThat(System.getProperty("mysql.url")).isNotBlank();
        temporary = temporary.toRealPath();
        Files.createDirectory(temporary.resolve("broker"),
                PosixFilePermissions.asFileAttribute(
                        PosixFilePermissions.fromString("rwx------")));
        Path workspace = Files
                .createDirectory(temporary.resolve("workspace-a"));
        workspaceDir = Files.createDirectory(workspace.resolve("child"));
        Files.writeString(workspaceDir.resolve("README.md"),
                "PRB seed: the audit target for the PR 13974 probe.\n");
        Files.createDirectory(temporary.resolve("harness-decoy"));
        Files.createDirectory(temporary.resolve("ctl"));
        port = freePort();
        harnessPort = freePort();
        proxyPort = freePort();
        storeProxyPort = freePort();
        brokerPort = freePort();
        model = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        modelThreads = Executors.newCachedThreadPool();
        model.setExecutor(modelThreads);
        model.createContext("/v1/chat/completions", this::modelReply);
        model.start();
        proxy = startNodeProxy(node, System.getProperty("probe.proxy"),
                proxyPort, harnessPort, "proxy", "hold-proxy");
        storeProxy = startNodeProxy(node,
                System.getProperty("probe.storeProxy"), storeProxyPort, port,
                "store", "store-proxy");
        startSpring(cli, node, workspace, shortLease);
        jdbc.update(
                "INSERT INTO managed_workspace_registry (tenant_id, workspace_id,"
                        + " workspace_generation, storage_id, display_name,"
                        + " config_ref, policy_ref, state) VALUES (?,"
                        + " 'workspace-0', 1, 'storage-0', 'PR13974', ?, ?,"
                        + " 'ACTIVE')",
                tenant, WorkspaceExecutionProfile.CONFIG_REF,
                WorkspaceExecutionProfile.POLICY_REF);
        jdbc.update(
                "INSERT INTO managed_workspace_access (tenant_id, workspace_id,"
                        + " actor_id, role) VALUES (?, 'workspace-0', ?,"
                        + " 'OPERATOR')",
                tenant, "actor".getBytes(StandardCharsets.UTF_8));
        harnessBuild = "on";
        startHarness();
        mark("stack up (" + probe + ")");
    }

    private Process startNodeProxy(String node, String script, int listen,
            int target, String name, String banner) throws Exception {
        assertThat(script).as("Pass the " + name + " proxy script")
                .isNotBlank();
        Path out = temporary.resolve(name + ".out");
        Process started = new ProcessBuilder(node, script,
                Integer.toString(listen), Integer.toString(target),
                temporary.resolve("ctl").toString(),
                temporary.resolve(name + ".jsonl").toString())
                .redirectErrorStream(true)
                .redirectOutput(out.toFile())
                .start();
        waiting().atMost(Duration.ofSeconds(10)).until(() ->
                Files.exists(out) && Files.readString(out).contains(banner));
        return started;
    }

    private void startSpring(Path cli, String node, Path workspace,
            boolean shortLease) {
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
                        + storeProxyPort,
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
                "--qwen.managed-agent.runtime-broker.credential-key-id=pr13974-fixture",
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
        if (shortLease)
            arguments.add("--qwen.managed-agent.session-store.writer-lease-duration=15s");
        if (approvals)
            arguments.add("--qwen.managed-agent.harness.approval-mode=default");
        spring = (ServletWebServerApplicationContext)
                new SpringApplicationBuilder(ManagedAgentServerApplication.class)
                        .initializers(context -> context.getBeanFactory()
                                .registerSingleton("pr13974Authentication",
                                        authentication()))
                        .run(arguments.toArray(String[]::new));
        jdbc = spring.getBean(JdbcTemplate.class);
    }

    private void startHarness() throws Exception {
        String node = System.getProperty("node.executable");
        Path cli = cli(harnessBuild);
        Path home = Files.createDirectory(
                temporary.resolve("home-" + UUID.randomUUID()));
        Path config = Files.createDirectory(home.resolve(".qwen"));
        String modelUrl = "http://127.0.0.1:" + model.getAddress().getPort()
                + "/v1";
        Files.writeString(config.resolve("settings.json"),
                compact.writeValueAsString(Map.of(
                        "security",
                        Map.of("auth", Map.of("selectedType", "openai")),
                        "model", Map.of("name", "pr13974-fixture"),
                        "telemetry", Map.of("enabled", false),
                        "modelProviders",
                        Map.of("openai", List.of(Map.of("id", "pr13974-fixture",
                                "envKey", "OPENAI_API_KEY", "baseUrl",
                                modelUrl, "generationConfig",
                                Map.of("timeout", 600000)))))));
        Path log = temporary.resolve("harness-" + System.currentTimeMillis()
                + "-" + harnessBuild + ".log");
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
        waiting().atMost(Duration.ofSeconds(90)).untilAsserted(() -> {
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
                .header("X-Pr13974-Fixture-Actor", "actor")
                .method(method,
                        body == null ? HttpRequest.BodyPublishers.noBody()
                                : HttpRequest.BodyPublishers.ofString(
                                        compact.writeValueAsString(body)));
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
                                        "X-Pr13974-Fixture-Actor");
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

    private void reply(HttpExchange exchange, Step step) throws IOException {
        reply(exchange, step.calls(), step.text());
    }

    private void reply(HttpExchange exchange,
            List<Map<String, Object>> calls, String text) throws IOException {
        ObjectNode chunk = compact.createObjectNode().put("id", "pr13974")
                .put("object", "chat.completion.chunk").put("created", 0)
                .put("model", "pr13974-fixture");
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
