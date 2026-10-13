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
import java.security.MessageDigest;
import java.security.Principal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
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
 * PR 13955 (H4e-b3c) physical pass: member-to-member messages on a real
 * Hosted stack. Spring on MySQL, the embedded Runtime Broker, the packaged
 * Hosted Harness (dist/cli.js serve --profile hosted-harness) and, between
 * Spring and the Harness, a logging pass-through proxy that can hold one
 * recipient's message deliveries. Only the model is scripted. Every probe
 * dumps its evidence (tool answers the model saw, rendered member inputs,
 * the lead's and members' journal records, relay rows, lead model
 * requests) to -Dprobe.out/<probe>.json whether or not it passes.
 */
class HostedPr13955ProbeMySqlIT {
    private static final String TOKEN = "pr13955-probe";
    private static final String DIGEST = "sha256:" + "d".repeat(64);
    private static final Pattern MEMBER = Pattern.compile(
            "PRB_MEMBER_([a-z]+)_GO");
    private static final Pattern LEAD = Pattern.compile(
            "PRB_LEAD_([A-Z0-9]+)");
    private static final Map<String, List<String>> ROSTER = Map.of(
            "P1", List.of("alice", "bob", "carol"),
            "P2", List.of("alice", "bob"),
            "P3", List.of("alice", "bob", "carol"),
            "P4", List.of("alice", "bob"),
            "P5", List.of("alice", "bob"),
            "P6", List.of("alice", "bob"),
            "P7", List.of("alice", "bob", "carol"),
            "P8", List.of("alice", "bob"));

    private final ObjectMapper json = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT);
    private final ObjectMapper compact = new ObjectMapper();
    private final HttpClient http = HttpClient.newHttpClient();
    private final String tenant = "pr13955-" + UUID.randomUUID();
    private final AtomicReference<Throwable> modelFailure =
            new AtomicReference<>();
    /** Every tool answer the model saw, by call id, as plain text. */
    private final Map<String, String> results = new ConcurrentHashMap<>();
    private final Map<String, Long> resultSeenAt = new ConcurrentHashMap<>();
    private final List<String> timeline = new CopyOnWriteArrayList<>();
    /** The tools each member's first model request declared (full JSON). */
    private final Map<String, JsonNode> declared = new ConcurrentHashMap<>();
    /** Each member's launch input as its model first saw it. */
    private final Map<String, String> firstInputs = new ConcurrentHashMap<>();
    /** Every rendered <session-message> input a member's model saw. */
    private final Map<String, List<String>> memberInputs =
            new ConcurrentHashMap<>();
    /** Every model request the lead made: when, and what woke it. */
    private final List<Map<String, Object>> leadRequests =
            new CopyOnWriteArrayList<>();
    /** The final texts each member's model produced, in order. */
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
            failure.printStackTrace(System.out);
        }
        try {
            jdbc.execute("DROP TRIGGER IF EXISTS pr13955_fail_receipt");
        } catch (Exception ignored) {
        }
        if (harness != null) {
            harness.descendants().forEach(ProcessHandle::destroy);
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
     * P1, the design's b3c physical pass: alice messages a running member
     * (bob), every other member ("*") while carol has already finished,
     * the finished member alone, a stranger, herself, "leader" and
     * "Parent"; bob answers alice by name and alice receives it.
     */
    @Test
    @Timeout(420)
    void p1PeerMessagesEndToEnd() throws Exception {
        probe = "P1";
        boot();
        String lead = createLead("PRB_LEAD_P1");
        waiting().atMost(Duration.ofSeconds(330))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(flags).contains("alice-got-bob");
                    assertThat(runStates(lead).values())
                            .allMatch(state -> !"running".equals(state));
                });
        settleRelay();
        mark("P1 settled");
        closeAndSettle(lead);
    }

    /**
     * P2, the member caps on a real relay: bob's deliveries are held at
     * the proxy while alice sends him five messages; the fifth finds four
     * member messages still on their way. The lead's own message to bob
     * still goes out (H4d-b's shared 8 in flight keeps room for it).
     */
    @Test
    @Timeout(420)
    void p2MemberInFlightCapOnTheRelay() throws Exception {
        probe = "P2";
        boot();
        String lead = createLead("PRB_LEAD_P2");
        String bob = waitForMemberSession(lead, "bob");
        Files.writeString(temporary.resolve("ctl/hold-receive"), bob + "\n");
        flags.add("hold-armed");
        mark("bob's receive is held at the proxy (" + bob + ")");
        waiting().atMost(Duration.ofSeconds(200))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("c5");
                });
        request("POST", "/v1/agents/sessions/" + lead + "/events",
                Map.of("type", "agent.session.input.message", "input",
                        List.of(Map.of("type", "input_text", "text",
                                "PRB_LEAD_SEND_BOB"))),
                "input-send-bob", 202);
        waiting().atMost(Duration.ofSeconds(90))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("lead-msg-bob");
                });
        facts.put("whileHeld.leadOutbound", outboundSummary(lead));
        Files.deleteIfExists(temporary.resolve("ctl/hold-receive"));
        flags.add("release");
        mark("bob's receive released");
        waiting().atMost(Duration.ofSeconds(150))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(runStates(lead).values())
                            .allMatch(state -> !"running".equals(state));
                });
        settleRelay();
        mark("P2 settled");
        closeAndSettle(lead);
    }

    /**
     * P3, the re-run probe: alice's "*" reaches bob and carol (both
     * running), then the lead's receipt commit is refused once by a MySQL
     * trigger, so the relay re-runs `execute` with both msgc_ entries
     * already committed. Nothing may be sent twice.
     */
    @Test
    @Timeout(420)
    void p3ReceiptRefusedOnceThenReExecuted() throws Exception {
        probe = "P3";
        boot();
        String lead = createLead("PRB_LEAD_P3");
        waitForMemberSession(lead, "alice");
        waitForMemberSession(lead, "bob");
        waitForMemberSession(lead, "carol");
        armReceiptTrigger(lead);
        flags.add("trigger-armed");
        mark("receipt trigger armed for lead " + lead);
        // Keep refusing the receipt until one whole execute has failed at
        // the proxy (the store client retries a commit inside one call),
        // then disarm: the relay's next execute is a re-run.
        waiting().atMost(Duration.ofSeconds(150))
                .pollInterval(Duration.ofMillis(200)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(failedExecutes()).isPositive();
                });
        jdbc.update("UPDATE pr13955_fault SET armed = 0 WHERE id = 1");
        facts.put("atDisarm.fault", jdbc.queryForList(
                "SELECT armed, fired, fired_at FROM pr13955_fault"));
        facts.put("atDisarm.leadOutbound", outboundSummary(lead));
        facts.put("atDisarm.leadReceipts", commandsWithReplies(lead));
        mark("receipt trigger disarmed after " + failedExecutes()
                + " failed execute(s)");
        waiting().atMost(Duration.ofSeconds(240))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("d1");
                });
        facts.put("afterAnswer.fault", jdbc.queryForList(
                "SELECT armed, fired, fired_at FROM pr13955_fault"));
        facts.put("afterAnswer.leadOutbound", outboundSummary(lead));
        flags.add("release");
        mark("bob and carol released");
        waiting().atMost(Duration.ofSeconds(150))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(runStates(lead).values())
                            .allMatch(state -> !"running".equals(state));
                });
        settleRelay();
        mark("P3 settled");
        closeAndSettle(lead);
    }

    /**
     * P4, sizes and escapes: a near-limit message rich in CJK, quotes,
     * backslashes and newlines; a message of control characters whose
     * JSON form outgrows the 64 KiB command arguments while its raw bytes
     * fit the 32 KiB envelope; and a plain over-limit message.
     */
    @Test
    @Timeout(420)
    void p4SizesAndEscapes() throws Exception {
        probe = "P4";
        boot();
        String lead = createLead("PRB_LEAD_P4");
        waiting().atMost(Duration.ofSeconds(240))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKeys("e1", "e3", "e4");
                });
        flags.add("release");
        mark("bob released; alice now sends the escape-dense e2");
        waiting().atMost(Duration.ofSeconds(180))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(runStates(lead).values())
                            .allMatch(state -> !"running".equals(state));
                });
        facts.put("e2.encodedToolInputBytes", encodedToolInputBytes(
                jsonArrayText()));
        facts.put("e2.rawEnvelopeBytes", ("<member-message from=\"alice\">\n"
                + jsonArrayText() + "\n</member-message>")
                .getBytes(StandardCharsets.UTF_8).length);
        settleRelay();
        mark("P4 settled");
        closeAndSettle(lead);
    }

    /**
     * P5, a stopping and then an ended recipient: the lead requests bob's
     * stop while the proxy holds his cancel, so bob reads as being
     * stopped; once released and settled he reads as ended, and "*"
     * reaches nobody.
     */
    @Test
    @Timeout(480)
    void p5StoppingThenEndedRecipient() throws Exception {
        probe = "P5";
        boot();
        String lead = createLead("PRB_LEAD_P5");
        waitForMemberSession(lead, "alice");
        String bob = waitForMemberSession(lead, "bob");
        Files.writeString(temporary.resolve("ctl/hold-cancel"), bob + "\n");
        mark("bob's cancel is held at the proxy");
        request("POST", "/v1/agents/sessions/" + lead + "/events",
                Map.of("type", "agent.session.input.message", "input",
                        List.of(Map.of("type", "input_text", "text",
                                "PRB_LEAD_STOP_BOB"))),
                "input-stop-bob", 202);
        waiting().atMost(Duration.ofSeconds(120))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("lead-stop-bob");
                });
        facts.put("afterStopRequest.runStates", runStates(lead));
        flags.add("stop-requested");
        waiting().atMost(Duration.ofSeconds(120))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("f1");
                });
        Files.deleteIfExists(temporary.resolve("ctl/hold-cancel"));
        mark("bob's cancel released");
        waiting().atMost(Duration.ofSeconds(180))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(runStates(lead).get("bob")).isNotEqualTo(
                            "running");
                });
        facts.put("afterStop.runStates", runStates(lead));
        flags.add("stopped");
        mark("bob's stop settled: " + runStates(lead));
        waiting().atMost(Duration.ofSeconds(120))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKeys("f2", "f3");
                });
        flags.add("release");
        waiting().atMost(Duration.ofSeconds(150))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(runStates(lead).values())
                            .allMatch(state -> !"running".equals(state));
                });
        settleRelay();
        mark("P5 settled");
        closeAndSettle(lead);
    }

    /**
     * P6, the pre-existing lane for comparison: the same control-character
     * text sent to "parent" (H4d-b's journal-only message, unchanged by
     * this PR), so base and head can be compared on the same failure.
     */
    @Test
    @Timeout(300)
    void p6ParentLaneControlText() throws Exception {
        probe = "P6";
        boot();
        String lead = createLead("PRB_LEAD_P6");
        waiting().atMost(Duration.ofSeconds(200))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(runStates(lead).get("alice")).isNotNull()
                            .isIn("settled", "failed", "cancelled");
                    assertThat(runStates(lead).get("bob")).isNotNull()
                            .isIn("settled", "failed", "cancelled");
                });
        settleRelay();
        mark("P6 settled: " + runStates(lead));
        closeAndSettle(lead);
    }

    /**
     * P7, P3 across a process boundary: the receipt is refused until one
     * execute fails (the lead's writes stop), then the Harness is killed
     * and restarted, so the reloaded lead re-runs the command with both
     * msgc_ entries already committed. Nothing may be sent twice.
     */
    @Test
    @Timeout(480)
    void p7ReExecuteAfterHarnessRestart() throws Exception {
        probe = "P7";
        boot();
        String lead = createLead("PRB_LEAD_P7");
        waitForMemberSession(lead, "alice");
        waitForMemberSession(lead, "bob");
        waitForMemberSession(lead, "carol");
        armReceiptTrigger(lead);
        flags.add("trigger-armed");
        mark("receipt trigger armed for lead " + lead);
        disarmAfterFailedExecute(lead);
        harness.descendants().forEach(ProcessHandle::destroyForcibly);
        harness.destroyForcibly();
        harness.waitFor(20, TimeUnit.SECONDS);
        mark("Harness killed");
        startHarness();
        mark("Harness restarted");
        waiting().atMost(Duration.ofSeconds(300))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("d1");
                });
        facts.put("afterAnswer.leadOutbound", outboundSummary(lead));
        flags.add("release");
        mark("bob and carol released");
        waiting().atMost(Duration.ofSeconds(180))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(runStates(lead).values())
                            .allMatch(state -> !"running".equals(state));
                });
        settleRelay();
        mark("P7 settled");
        closeAndSettle(lead);
    }

    /**
     * P8, the same refused receipt on a b3b board write (no member message
     * involved), run on base and head: whether the lead's stopped writes
     * wedge the command channel independently of this PR.
     */
    @Test
    @Timeout(420)
    void p8BoardWriteReceiptRefused() throws Exception {
        probe = "P8";
        boot();
        String lead = createLead("PRB_LEAD_P8");
        waitForMemberSession(lead, "alice");
        armReceiptTrigger(lead);
        flags.add("trigger-armed");
        mark("receipt trigger armed for lead " + lead);
        disarmAfterFailedExecute(lead);
        waiting().atMost(Duration.ofSeconds(240))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(results).containsKey("h1");
                });
        facts.put("afterAnswer.leadReceipts", commandsWithReplies(lead));
        flags.add("release");
        waiting().atMost(Duration.ofSeconds(120))
                .pollInterval(Duration.ofSeconds(1)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(runStates(lead).values())
                            .allMatch(state -> !"running".equals(state));
                });
        settleRelay();
        mark("P8 settled");
        closeAndSettle(lead);
    }

    // ------------------------------------------------------------ the model

    private void modelReply(HttpExchange exchange) throws IOException {
        try {
            JsonNode body = json.readTree(exchange.getRequestBody());
            recordResults(body);
            String first = firstUserText(body);
            Matcher member = MEMBER.matcher(first);
            if (member.find()) {
                String name = member.group(1);
                declared.putIfAbsent(name, body.path("tools"));
                firstInputs.putIfAbsent(name, first);
                recordMemberInputs(name, body);
                Step step = memberPlan(name, body);
                if (step.calls().isEmpty())
                    finals.computeIfAbsent(name,
                            key -> new CopyOnWriteArrayList<>())
                            .add(step.text());
                reply(exchange, step);
                return;
            }
            Matcher lead = LEAD.matcher(first);
            if (lead.find()) {
                Map<String, Object> seen = new LinkedHashMap<>();
                seen.put("atSec", (System.currentTimeMillis() - started)
                        / 1000.0);
                seen.put("lastRole", lastRole(body));
                String last = withoutReminders(lastUserText(body));
                seen.put("lastUser", last.substring(0,
                        Math.min(1500, last.length())));
                leadRequests.add(seen);
                reply(exchange, leadPlan(body));
                return;
            }
            throw new AssertionError("Unknown model request: " + first);
        } catch (IOException broken) {
            // The Harness gave up on a held request: not a fixture fault.
            mark("model connection closed by the Harness: " + broken);
        } catch (Exception | AssertionError failure) {
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
                                Math.min(220, text.length())));
            }
        }
    }

    private void recordMemberInputs(String name, JsonNode body) {
        List<String> seen = memberInputs.computeIfAbsent(name,
                key -> new CopyOnWriteArrayList<>());
        for (JsonNode message : body.path("messages")) {
            if (!"user".equals(message.path("role").asText())) continue;
            String text = withoutReminders(userText(message));
            if (text.contains("<session-message>") && !seen.contains(text)) {
                seen.add(text);
                mark(name + " model saw input: " + text.replace("\n", " | ")
                        .substring(0, Math.min(260, text.length())));
            }
        }
    }

    private Step leadPlan(JsonNode body) {
        Set<String> ids = callIds(body);
        String last = lastUserText(body);
        if ("user".equals(lastRole(body)) && last.contains("PRB_LEAD_SEND_BOB")
                && !ids.contains("lead-msg-bob")) {
            return new Step(List.of(call("lead-msg-bob", "send_message",
                    Map.of("to", "bob", "message",
                            "PRB_LEAD_NOTE the lead's own message"))), null);
        }
        if ("user".equals(lastRole(body)) && last.contains("PRB_LEAD_STOP_BOB")
                && !ids.contains("lead-stop-bob")) {
            return new Step(List.of(call("lead-stop-bob", "request_shutdown",
                    Map.of("to", "bob"))), null);
        }
        if (!ids.contains("lead-create")) {
            return new Step(List.of(call("lead-create", "team_create",
                    Map.of("team_name", "review"))), null);
        }
        List<String> roster = ROSTER.get(probe);
        if (!ids.contains("lead-launch-" + roster.get(0))) {
            List<Map<String, Object>> launches = new ArrayList<>();
            for (String name : roster) {
                mark("lead launches " + name);
                launches.add(call("lead-launch-" + name, "agent", Map.of(
                        "description", name + " probe",
                        "prompt", "PRB_MEMBER_" + name + "_GO",
                        "name", name)));
            }
            return new Step(launches, null);
        }
        return new Step(List.of(), "LEAD_IDLE");
    }

    private Step memberPlan(String name, JsonNode body) {
        return switch (probe) {
            case "P1" -> p1Member(name, body);
            case "P2" -> p2Member(name, body);
            case "P3" -> p3Member(name, body);
            case "P4" -> p4Member(name, body);
            case "P5" -> p5Member(name, body);
            case "P7" -> p3Member(name, body);
            case "P8" -> name.equals("alice")
                    ? (issuedCallIds(body).contains("h1")
                            ? holdThen("release", "ALICE_REPORT board")
                            : holdThenCall("trigger-armed", "h1", "task_create",
                                    Map.of("subject", "PRB_BOARD audit",
                                            "description", "a board write")))
                    : new Step(List.of(), "BOB_REPORT");
            case "P6" -> name.equals("alice")
                    ? (issuedCallIds(body).contains("g1")
                            ? new Step(List.of(), "ALICE_REPORT parent lane")
                            : one("g1", "send_message", Map.of("to", "parent",
                                    "message", jsonArrayText())))
                    : new Step(List.of(), "BOB_REPORT");
            default -> throw new AssertionError("no probe " + probe);
        };
    }

    private static final List<Map<String, Object>> P1_ALICE = List.of(
            call("a1", "send_message", Map.of("to", "bob", "message",
                    "PRB_HELLO_BOB please confirm you saw the audit note")),
            call("a2", "send_message", Map.of("to", "*", "message",
                    "PRB_ALL status ping from alice")),
            call("a3", "send_message", Map.of("to", "carol", "message",
                    "PRB_CAROL are you still there?")),
            call("a4", "send_message", Map.of("to", "zed", "message",
                    "PRB_ZED hello stranger")),
            call("a5", "send_message", Map.of("to", "alice", "message",
                    "PRB_SELF note to myself")),
            call("a6", "send_message", Map.of("to", "leader", "message",
                    "PRB_LEADER question")),
            call("a7", "send_message", Map.of("to", "Parent", "message",
                    "PRB_PARENT a note for the lead")));

    private Step p1Member(String name, JsonNode body) {
        Set<String> ids = callIds(body);
        Set<String> issued = issuedCallIds(body);
        boolean freshInput = "user".equals(lastRole(body));
        String last = lastUserText(body);
        switch (name) {
            case "carol" -> {
                return new Step(List.of(), "CAROL_REPORT nothing to add");
            }
            case "bob" -> {
                if (freshInput && last.contains("<from>member alice</from>")) {
                    if (!issued.contains("b-reply")) {
                        return one("b-reply", "send_message", Map.of("to",
                                "alice", "message",
                                "PRB_REPLY bob to alice: confirmed"));
                    }
                    return new Step(List.of(), "BOB_SAW_AGAIN");
                }
                if (ids.contains("b-reply")) {
                    return new Step(List.of(), "BOB_REPLIED");
                }
                holdUntil(() -> results.containsKey("a2"), 100,
                        "bob holds his first answer until alice's a2");
                return new Step(List.of(), "BOB_FIRST_ANSWER");
            }
            case "alice" -> {
                if (freshInput && last.contains("<from>member bob</from>")) {
                    flags.add("alice-got-bob");
                    return new Step(List.of(), "ALICE_GOT_BOB");
                }
                if (!issued.contains("a1")) {
                    holdUntil(() -> "settled".equals(
                            runStates(leadSession).get("carol")), 90,
                            "alice waits for carol's run to settle");
                }
                for (Map<String, Object> step : P1_ALICE) {
                    if (!issued.contains(step.get("id").toString()))
                        return new Step(List.of(step), null);
                }
                holdUntil(() -> results.containsKey("b-reply"), 100,
                        "alice holds her answer until bob's reply is sent");
                return new Step(List.of(), "ALICE_REPORT all steps done");
            }
            default -> throw new AssertionError("Unknown member " + name);
        }
    }

    private Step p2Member(String name, JsonNode body) {
        Set<String> issued = issuedCallIds(body);
        boolean freshInput = "user".equals(lastRole(body));
        switch (name) {
            case "bob" -> {
                if (freshInput && lastUserText(body)
                        .contains("<session-message>")) {
                    return new Step(List.of(), "BOB_SAW");
                }
                holdUntil(() -> flags.contains("release"), 300,
                        "bob holds his first answer until released");
                return new Step(List.of(), "BOB_FIRST_ANSWER");
            }
            case "alice" -> {
                if (freshInput && lastUserText(body)
                        .contains("<session-message>")) {
                    return new Step(List.of(), "ALICE_SAW");
                }
                if (!issued.contains("c1")) {
                    holdUntil(() -> flags.contains("hold-armed"), 120,
                            "alice waits for the receive hold");
                }
                for (int n = 1; n <= 5; n++) {
                    if (!issued.contains("c" + n))
                        return one("c" + n, "send_message", Map.of("to", "bob",
                                "message", "PRB_CAP_" + n + " ping " + n));
                }
                holdUntil(() -> flags.contains("release"), 300,
                        "alice holds her answer until released");
                return new Step(List.of(), "ALICE_REPORT caps");
            }
            default -> throw new AssertionError("Unknown member " + name);
        }
    }

    private Step p3Member(String name, JsonNode body) {
        Set<String> issued = issuedCallIds(body);
        boolean freshInput = "user".equals(lastRole(body));
        if (freshInput && lastUserText(body).contains("<session-message>")) {
            return new Step(List.of(), name.toUpperCase() + "_SAW");
        }
        if (name.equals("alice")) {
            if (!issued.contains("d1")) {
                holdUntil(() -> flags.contains("trigger-armed"), 120,
                        "alice waits for the receipt trigger");
                return one("d1", "send_message", Map.of("to", "*", "message",
                        "PRB_RERUN hello every other member"));
            }
            holdUntil(() -> flags.contains("release"), 300,
                    "alice holds her answer until released");
            return new Step(List.of(), "ALICE_REPORT rerun");
        }
        holdUntil(() -> flags.contains("release"), 300,
                name + " holds the first answer until released");
        return new Step(List.of(), name.toUpperCase() + "_FIRST_ANSWER");
    }

    /** ~32 KiB envelope of CJK, quotes, backslashes and newlines. */
    static String richText() {
        StringBuilder text = new StringBuilder("PRB_RICH ");
        String unit = "审计\"引号\\反斜杠\n";
        while (text.toString().getBytes(StandardCharsets.UTF_8).length
                + unit.getBytes(StandardCharsets.UTF_8).length
                + "<member-message from=\"alice\">\n\n</member-message>"
                        .length() <= 32 * 1024 - 64) {
            text.append(unit);
        }
        return text.toString();
    }

    /**
     * A JSON array of 6,500 short strings (26 KB raw, 32,549 bytes as a
     * member-message envelope, so inside the 32 KiB local bound) whose
     * quotes inflate the doubly encoded tool input past 64 KiB.
     */
    static String jsonArrayText() {
        StringBuilder text = new StringBuilder("[");
        for (int i = 0; i < 6500; i++) {
            if (i > 0) text.append(',');
            text.append("\"a").append(i % 10).append('"');
        }
        return text.append(']').toString();
    }

    /** encodeToolInput's measure: the payload JSON inside a JSON body. */
    private long encodedToolInputBytes(String message) throws Exception {
        String payload = compact.writeValueAsString(Map.of("toolName",
                "send_message", "input", Map.of("to", "bob", "message",
                        message)));
        return compact.writeValueAsString(Map.of("harnessSessionId",
                "x".repeat(36), "runtimeSessionId", "y".repeat(36),
                "payloadJson", payload)).getBytes(StandardCharsets.UTF_8)
                .length;
    }

    /** 12,000 control characters: 12 KB raw, 72 KB as JSON. */
    static String controlText() {
        return "PRB_CTRL " + "\u0001".repeat(12_000);
    }

    private Step p4Member(String name, JsonNode body) {
        Set<String> issued = issuedCallIds(body);
        boolean freshInput = "user".equals(lastRole(body));
        if (freshInput && lastUserText(body).contains("<session-message>")) {
            return new Step(List.of(), name.toUpperCase() + "_SAW");
        }
        if (name.equals("bob")) {
            holdUntil(() -> flags.contains("release"), 300,
                    "bob holds the first answer until released");
            return new Step(List.of(), "BOB_FIRST_ANSWER");
        }
        if (!issued.contains("e1"))
            return one("e1", "send_message", Map.of("to", "bob", "message",
                    richText()));
        if (!issued.contains("e3"))
            return one("e3", "send_message", Map.of("to", "bob", "message",
                    "PRB_BIG " + "x".repeat(33_000)));
        if (!issued.contains("e4"))
            return one("e4", "send_message", Map.of("to", "bob", "message",
                    "PRB_AFTER still able to send"));
        if (!issued.contains("e2")) {
            holdUntil(() -> flags.contains("release"), 300,
                    "alice waits for bob's release before e2");
            return one("e2", "send_message", Map.of("to", "bob", "message",
                    jsonArrayText()));
        }
        return new Step(List.of(), "ALICE_REPORT sizes");
    }

    private Step p5Member(String name, JsonNode body) {
        Set<String> issued = issuedCallIds(body);
        boolean freshInput = "user".equals(lastRole(body));
        if (freshInput && lastUserText(body).contains("<session-message>")) {
            return new Step(List.of(), name.toUpperCase() + "_SAW");
        }
        if (name.equals("bob")) {
            holdUntil(() -> flags.contains("release"), 400,
                    "bob holds the first answer until released");
            return new Step(List.of(), "BOB_FIRST_ANSWER");
        }
        if (!issued.contains("f1")) {
            holdUntil(() -> flags.contains("stop-requested"), 300,
                    "alice waits for the lead's stop request");
            return one("f1", "send_message", Map.of("to", "bob", "message",
                    "PRB_STOPPING are you being stopped?"));
        }
        if (!issued.contains("f2")) {
            holdUntil(() -> flags.contains("stopped"), 300,
                    "alice waits for bob's stop to settle");
            return one("f2", "send_message", Map.of("to", "bob", "message",
                    "PRB_ENDED one more note"));
        }
        if (!issued.contains("f3"))
            return one("f3", "send_message", Map.of("to", "*", "message",
                    "PRB_NOBODY anyone left?"));
        holdUntil(() -> flags.contains("release"), 300,
                "alice holds her answer until released");
        return new Step(List.of(), "ALICE_REPORT stop");
    }

    private Step holdThen(String flag, String text) {
        holdUntil(() -> flags.contains(flag), 300, "hold for " + flag);
        return new Step(List.of(), text);
    }

    private Step holdThenCall(String flag, String id, String tool,
            Map<String, Object> args) {
        holdUntil(() -> flags.contains(flag), 300, "hold for " + flag);
        return one(id, tool, args);
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

    // ------------------------------------------------------------ evidence

    private void mark(String what) {
        String line = String.format("+%6.1fs %s",
                (System.currentTimeMillis() - started) / 1000.0, what);
        timeline.add(line);
        System.out.println("[probe] " + line);
    }

    private void settleRelay() {
        try {
            waiting().atMost(Duration.ofSeconds(90))
                    .pollInterval(Duration.ofSeconds(1)).untilAsserted(() ->
                            assertThat(jdbc.queryForList(
                                    "SELECT message_id, state FROM"
                                            + " qwen_managed_session_message_relay"
                                            + " WHERE tenant_id = ? AND state NOT"
                                            + " IN ('done','unknown')", tenant))
                                    .isEmpty());
        } catch (Throwable failure) {
            mark("relay did not settle: " + failure.getMessage());
        }
    }

    private void dumpEvidence(String test) throws Exception {
        if (jdbc == null) return;
        Path out = Path.of(System.getProperty("probe.out",
                "target/pr13955-probe"));
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
        evidence.put("declaredTools", declared);
        evidence.put("firstInputs", firstInputs);
        evidence.put("memberInputs", memberInputs);
        evidence.put("leadRequests", leadRequests);
        if (leadSession != null) {
            evidence.put("team", rows(leadSession, "team_state").stream()
                    .map(this::body).toList());
            Map<String, Object> runs = new LinkedHashMap<>();
            for (Map<String, Object> row : rows(leadSession, "child_run"))
                runs.put(row.get("record_id") + "#" + row.get("revision"),
                        body(row));
            evidence.put("childRuns", runs);
            evidence.put("runStates", runStates(leadSession));
            evidence.put("leadMessages", messagesWithContent(leadSession));
            evidence.put("leadReceipts", commandsWithReplies(leadSession));
            Map<String, Object> members = new LinkedHashMap<>();
            for (Map.Entry<String, String> member
                    : memberSessions(leadSession).entrySet()) {
                Map<String, Object> view = new LinkedHashMap<>();
                view.put("sessionId", member.getValue());
                view.put("messages", messagesWithContent(member.getValue()));
                view.put("commands", commandsWithReplies(member.getValue()));
                view.put("turns", jdbc.queryForList(
                        "SELECT turn_id, status, error_code FROM"
                                + " managed_agent_turn WHERE tenant_id = ? AND"
                                + " session_id = ? ORDER BY created_at",
                        tenant, member.getValue()));
                members.put(member.getKey(), view);
            }
            evidence.put("members", members);
            evidence.put("idCheck", idCheck(leadSession));
            evidence.put("relayRows", jdbc.queryForList(
                    "SELECT sender_session_id, message_id, target_session_id,"
                            + " state, attempts, last_error FROM"
                            + " qwen_managed_session_message_relay WHERE"
                            + " tenant_id = ? ORDER BY created_at", tenant));
            evidence.put("leadTurns", jdbc.queryForList(
                    "SELECT turn_id, status, error_code FROM managed_agent_turn"
                            + " WHERE tenant_id = ? AND session_id = ?"
                            + " ORDER BY created_at", tenant, leadSession));
            evidence.put("leadJournalOps", jdbc.queryForList(
                    "SELECT operation, COUNT(*) AS n FROM"
                            + " qwen_managed_session_journal_tx WHERE"
                            + " tenant_id = ? AND session_id = ? GROUP BY"
                            + " operation ORDER BY operation", tenant,
                    leadSession));
            try {
                evidence.put("fault", jdbc.queryForList(
                        "SELECT armed, fired, fired_at FROM pr13955_fault"));
            } catch (Exception ignored) {
            }
        }
        Path proxyLog = temporary.resolve("proxy.jsonl");
        if (Files.exists(proxyLog)) {
            List<Object> ops = new ArrayList<>();
            for (String line : Files.readAllLines(proxyLog))
                ops.add(json.readTree(line));
            evidence.put("proxyMessageOperations", ops);
        }
        List<String> harnessLines = new ArrayList<>();
        try (var logs = Files.list(temporary)) {
            for (Path log : logs.filter(path -> Files.isRegularFile(path)
                    && path.getFileName().toString().startsWith("harness-")
                    && path.getFileName().toString().endsWith(".log"))
                    .toList()) {
                for (String line : Files.readAllLines(log)) {
                    if (line.contains("qwen serve") || line.contains("rror"))
                        harnessLines.add(line.substring(0,
                                Math.min(600, line.length())));
                }
            }
        }
        evidence.put("harnessLogLines", harnessLines);
        Files.writeString(out.resolve(test + ".json"),
                json.writeValueAsString(evidence));
        System.out.println("[probe] evidence -> " + out.resolve(test + ".json"));
    }

    /** Every msgc_ id recomputed here from (lead, commandId, position). */
    private List<Map<String, Object>> idCheck(String lead) throws Exception {
        List<Map<String, Object>> out = new ArrayList<>();
        JsonNode team = rows(lead, "team_state").stream().map(this::body)
                .reduce((a, b) -> b).orElse(null);
        Map<String, Integer> position = new LinkedHashMap<>();
        Map<String, String> rootOfName = new LinkedHashMap<>();
        if (team != null) {
            int index = 1;
            for (JsonNode member : team.path("members")) {
                position.put(member.path("name").asText(), index++);
                rootOfName.put(member.path("childRunId").asText(),
                        member.path("name").asText());
            }
        }
        for (Map<String, Object> row : latestRows(lead, "session_message")) {
            String id = row.get("record_id").toString();
            if (!id.startsWith("msgc_")) continue;
            JsonNode message = body(row);
            String command = message.at("/run/executionCallId").asText();
            String recipient = rootOfName.get(message.path("childRunId")
                    .asText());
            Map<String, Object> check = new LinkedHashMap<>();
            check.put("messageId", id);
            check.put("executionCallId", command);
            check.put("recipientByRootRun", recipient);
            String matched = null;
            for (Map.Entry<String, Integer> entry : position.entrySet()) {
                String expect = "msgc_" + sha256(lead + "\0" + command + "\0"
                        + entry.getValue()).substring(0, 32);
                if (expect.equals(id)) matched = entry.getKey();
            }
            check.put("idMatchesPositionOf", matched);
            out.add(check);
        }
        return out;
    }

    private static String sha256(String text) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(text.getBytes(StandardCharsets.UTF_8)));
    }

    private void armReceiptTrigger(String lead) {
        jdbc.execute("DROP TABLE IF EXISTS pr13955_fault");
        jdbc.execute("CREATE TABLE pr13955_fault (id INT PRIMARY KEY,"
                + " armed INT NOT NULL, fired INT NOT NULL,"
                + " fired_at BIGINT NULL) ENGINE=MEMORY");
        jdbc.update("INSERT INTO pr13955_fault VALUES (1, 1, 0, NULL)");
        jdbc.execute("DROP TRIGGER IF EXISTS pr13955_fail_receipt");
        jdbc.execute("CREATE TRIGGER pr13955_fail_receipt BEFORE INSERT ON"
                + " qwen_managed_session_extension_record FOR EACH ROW BEGIN"
                + " IF NEW.domain = 'session_command' AND NEW.session_id = '"
                + lead + "' AND (SELECT armed FROM pr13955_fault WHERE id = 1)"
                + " = 1 THEN UPDATE pr13955_fault SET"
                + " fired = fired + 1, fired_at = UNIX_TIMESTAMP(NOW(3)) * 1000"
                + " WHERE id = 1; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT ="
                + " 'pr13955 probe: the lead receipt commit is refused';"
                + " END IF; END");
    }

    private void disarmAfterFailedExecute(String lead) throws Exception {
        waiting().atMost(Duration.ofSeconds(150))
                .pollInterval(Duration.ofMillis(200)).untilAsserted(() -> {
                    assertNoModelFailure();
                    assertThat(failedExecutes()).isPositive();
                });
        jdbc.update("UPDATE pr13955_fault SET armed = 0 WHERE id = 1");
        facts.put("atDisarm.fault", jdbc.queryForList(
                "SELECT armed, fired, fired_at FROM pr13955_fault"));
        facts.put("atDisarm.leadOutbound", outboundSummary(lead));
        facts.put("atDisarm.leadReceipts", commandsWithReplies(lead));
        mark("receipt trigger disarmed after " + failedExecutes()
                + " failed execute(s)");
    }

    private long failedExecutes() throws IOException {
        Path log = temporary.resolve("proxy.jsonl");
        if (!Files.exists(log)) return 0;
        long failed = 0;
        for (String line : Files.readAllLines(log)) {
            JsonNode op = json.readTree(line);
            if ("execute".equals(op.path("kind").asText())
                    && op.path("status").asInt(0) != 202)
                failed += 1;
        }
        return failed;
    }

    private List<Map<String, Object>> outboundSummary(String session) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : latestRows(session, "session_message")) {
            JsonNode message = body(row);
            if (!"outbound".equals(message.path("direction").asText()))
                continue;
            out.add(Map.of("messageId", row.get("record_id"),
                    "state", message.at("/run/delivery/state").asText(),
                    "childRunId", message.path("childRunId").asText()));
        }
        return out;
    }

    private List<Map<String, Object>> messagesWithContent(String session) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : latestRows(session, "session_message")) {
            JsonNode message = body(row);
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("messageId", row.get("record_id"));
            view.put("revision", row.get("revision"));
            view.put("record", message);
            String content = resourceText(session,
                    message.at("/contentRef/resourceId").asText());
            view.put("contentHead", content == null ? null
                    : content.substring(0, Math.min(300, content.length())));
            view.put("contentBytes", content == null ? -1
                    : content.getBytes(StandardCharsets.UTF_8).length);
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
                    : args.substring(0, Math.min(200, args.length())));
            view.put("argsBytes", command.at("/argsRef/byteLength").asLong());
            String reply = resourceText(session,
                    command.at("/replyRef/resourceId").asText());
            view.put("reply", reply);
            out.add(view);
        }
        return out;
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

    /** name -> member Session id, read off the roster and child runs. */
    private Map<String, String> memberSessions(String lead) {
        Map<String, String> out = new LinkedHashMap<>();
        JsonNode team = rows(lead, "team_state").stream().map(this::body)
                .reduce((a, b) -> b).orElse(null);
        if (team == null) return out;
        Map<String, JsonNode> runs = latestRuns(lead);
        for (JsonNode member : team.path("members")) {
            JsonNode run = runs.get(member.path("childRunId").asText());
            if (run != null && !run.path("childSessionId").isNull()
                    && !run.path("childSessionId").asText().isEmpty())
                out.put(member.path("name").asText(),
                        run.path("childSessionId").asText());
        }
        return out;
    }

    /** name -> the run state of the chain head (root or continuation). */
    private Map<String, String> runStates(String lead) {
        Map<String, String> out = new LinkedHashMap<>();
        if (lead == null) return out;
        JsonNode team = rows(lead, "team_state").stream().map(this::body)
                .reduce((a, b) -> b).orElse(null);
        if (team == null) return out;
        Map<String, JsonNode> runs = latestRuns(lead);
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

    private Map<String, JsonNode> latestRuns(String lead) {
        Map<String, JsonNode> out = new LinkedHashMap<>();
        for (Map<String, Object> row : latestRows(lead, "child_run"))
            out.put(row.get("record_id").toString(), body(row));
        return out;
    }

    private String waitForMemberSession(String lead, String name) {
        AtomicReference<String> found = new AtomicReference<>();
        waiting().atMost(Duration.ofSeconds(120))
                .pollInterval(Duration.ofMillis(500)).untilAsserted(() -> {
                    assertNoModelFailure();
                    String session = memberSessions(lead).get(name);
                    assertThat(session).isNotNull();
                    found.set(session);
                });
        mark(name + " attached as " + found.get());
        return found.get();
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

    private static String lastRole(JsonNode body) {
        String role = "";
        for (JsonNode message : body.path("messages"))
            role = message.path("role").asText();
        return role;
    }

    /** The call ids whose tool results this request carries. */
    private static Set<String> callIds(JsonNode body) {
        Set<String> ids = new java.util.LinkedHashSet<>();
        for (JsonNode message : body.path("messages"))
            if ("tool".equals(message.path("role").asText()))
                ids.add(message.path("tool_call_id").asText());
        return ids;
    }

    /** The call ids the assistant already issued in this history. */
    private static Set<String> issuedCallIds(JsonNode body) {
        Set<String> ids = new java.util.LinkedHashSet<>();
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

    /** One row per record: its newest revision. */
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

    private void boot() throws Exception {
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
                        + " 'workspace-0', 1, 'storage-0', 'PR13955', ?, ?,"
                        + " 'ACTIVE')",
                tenant, WorkspaceExecutionProfile.CONFIG_REF,
                WorkspaceExecutionProfile.POLICY_REF);
        jdbc.update(
                "INSERT INTO managed_workspace_access (tenant_id, workspace_id,"
                        + " actor_id, role) VALUES (?, 'workspace-0', ?,"
                        + " 'OPERATOR')",
                tenant, "actor".getBytes(StandardCharsets.UTF_8));
        startHarness();
        mark("stack up (" + probe + ")");
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
                "--qwen.managed-agent.runtime-broker.credential-key-id=pr13955-fixture",
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
        if ("P7".equals(probe))
            arguments.add("--qwen.managed-agent.session-store.writer-lease-duration=15s");
        spring = (ServletWebServerApplicationContext)
                new SpringApplicationBuilder(ManagedAgentServerApplication.class)
                        .initializers(context -> context.getBeanFactory()
                                .registerSingleton("pr13955Authentication",
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
                compact.writeValueAsString(Map.of(
                        "security",
                        Map.of("auth", Map.of("selectedType", "openai")),
                        "model", Map.of("name", "pr13955-fixture"),
                        "telemetry", Map.of("enabled", false),
                        "modelProviders",
                        Map.of("openai", List.of(Map.of("id", "pr13955-fixture",
                                "envKey", "OPENAI_API_KEY", "baseUrl",
                                modelUrl, "generationConfig",
                                Map.of("timeout", 600000)))))));
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
        waiting().atMost(Duration.ofSeconds(60)).untilAsserted(() -> {
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
                .header("X-Pr13955-Fixture-Actor", "actor")
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
                                        "X-Pr13955-Fixture-Actor");
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
        ObjectNode chunk = compact.createObjectNode().put("id", "pr13955")
                .put("object", "chat.completion.chunk").put("created", 0)
                .put("model", "pr13955-fixture");
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
