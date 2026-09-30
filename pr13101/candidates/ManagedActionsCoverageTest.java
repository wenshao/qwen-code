package com.alibaba.qwen.code.managedagent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.RETURNS_DEFAULTS;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.qwen.code.daemon.DaemonHttpException;
import com.alibaba.qwen.code.managedagent.api.ApiException;
import com.alibaba.qwen.code.managedagent.api.AuthenticatedTenantActor;
import com.alibaba.qwen.code.managedagent.api.TenantContextFilter;
import com.alibaba.qwen.code.managedagent.harness.HarnessConnector;
import com.alibaba.qwen.code.managedagent.store.AgentStateStore;
import com.alibaba.qwen.code.managedagent.store.ManagedActionStore;
import com.alibaba.qwen.code.managedagent.store.ManagedSessionStore;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import org.junit.jupiter.api.Test;
import org.mockito.stubbing.Answer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.convention.TestBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/** Checks on the Action projection and routes that ManagedActionsTest leaves open. */
@SpringBootTest(
        properties = {
            "spring.datasource.url=jdbc:h2:mem:managed-actions-coverage;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
            "spring.datasource.driver-class-name=org.h2.Driver",
            "spring.datasource.username=sa",
            "spring.datasource.password=",
            "qwen.managed-agent.harness.enabled=false",
            "qwen.managed-agent.dispatch.retry-initial-delay=20ms",
            "qwen.managed-agent.dispatch.scan-delay=50ms"
        })
@AutoConfigureMockMvc
class ManagedActionsCoverageTest {
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper json;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private ManagedSessionStore journals;
    @Autowired private ManagedActionStore actions;
    @Autowired private AgentStateStore sessions;

    // Only the injection point of the override below; never read.
    @TestBean(methodName = "createHarness")
    private HarnessConnector harness;

    private static final Map<String, Answer<Void>> responses = new ConcurrentHashMap<>();

    static HarnessConnector createHarness() {
        return mock(
                HarnessConnector.class,
                call -> {
                    if ("resolveAction".equals(call.getMethod().getName())) {
                        Answer<Void> answer = responses.get(call.getArgument(2));
                        return answer == null ? null : answer.answer(call);
                    }
                    return RETURNS_DEFAULTS.answer(call);
                });
    }

    @Test
    void endedActionsAndKnownOptionsCannotChange() throws Exception {
        String tenant = tenant();
        String session = session(tenant);
        ActionJournal ended = action(tenant, session, 100, 1000);
        ended.change("expired", null);
        assertRejected(() -> ended.change("decided", decision("allow")));
        assertRejected(() -> ended.change("cancelled", null));
        assertThat(actions.find(tenant, session, ended.id).orElseThrow().state())
                .isEqualTo("expired");

        ActionJournal open = new ActionJournal(ended, 200, 5000);
        open.change("requested", null);
        open.options.put("expiresAt", 6000);
        assertRejected(() -> open.change("decided", decision("allow")));
        assertThat(actions.find(tenant, session, open.id).orElseThrow().state())
                .isEqualTo("requested");
    }

    @Test
    void expiryMustFollowCreation() throws Exception {
        String tenant = tenant();
        String session = session(tenant);
        ActionJournal action = new ActionJournal(journals, tenant, session, 1000, 1000);
        assertRejected(() -> action.change("requested", null));
        assertThat(actions.find(tenant, session, action.id)).isEmpty();
    }

    @Test
    void eachChangeAppendsAnActionUpdatedEvent() throws Exception {
        String tenant = tenant();
        String session = session(tenant);
        ActionJournal action = action(tenant, session, 100, 9007199254740991L);
        action.change("decided", decision("deny"));
        JsonNode events =
                read(auth(get("/v1/agents/sessions/{session}/events", session), tenant, "owner"));
        List<String> states = new ArrayList<>();
        for (JsonNode event : events.path("data")) {
            if ("action.updated".equals(event.path("type").asText())) {
                assertThat(event.at("/data/actionId").asText()).isEqualTo(action.id);
                states.add(event.at("/data/state").asText());
            }
        }
        assertThat(states).containsExactly("requested", "decided");
    }

    @Test
    void onlyPermissionResponsesAreAdmittedAndUnreadableSessionsStayHidden() throws Exception {
        String tenant = tenant();
        String session = session(tenant);
        ActionJournal action = action(tenant, session, System.currentTimeMillis(), 9007199254740991L);
        mvc.perform(
                        auth(post(path(session, action.id) + "/responses"), tenant, "owner")
                                .header("Idempotency-Key", "question")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(response("allow").replace("permission", "question")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("invalid_action_response"));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM managed_agent_operation WHERE tenant_id = ?"
                                        + " AND session_id = ?",
                                Integer.class,
                                tenant,
                                session))
                .isZero();
        // The Session check answers before the Action lookup.
        mvc.perform(auth(get(path(session, action.id)), tenant(), "owner"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("session_not_found"));
        mvc.perform(
                        auth(post("/api/agent/web-shell/v1/actions/get"), tenant(), "owner")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        json.writeValueAsString(
                                                Map.of("sessionId", session, "actionId", action.id))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("session_not_found"));
    }

    @Test
    void fullLastPageReportsNoMore() throws Exception {
        String tenant = tenant();
        String session = session(tenant);
        ActionJournal first = action(tenant, session, 100, 9007199254740991L);
        ActionJournal second = new ActionJournal(first, 200, 9007199254740991L);
        second.change("requested", null);
        JsonNode page =
                read(
                        auth(get("/v1/agents/sessions/{session}/actions", session), tenant, "owner")
                                .param("limit", "2"));
        assertThat(page.path("data")).hasSize(2);
        assertThat(page.path("has_more").asBoolean()).isFalse();
        assertThat(page.path("next_cursor").isNull()).isTrue();
        JsonNode web =
                read(
                        auth(post("/api/agent/web-shell/v1/actions/query"), tenant, "owner")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        json.writeValueAsString(
                                                Map.of("sessionId", session, "limit", 2))));
        assertThat(web.path("data")).hasSize(2);
        assertThat(web.path("hasMore").asBoolean()).isFalse();
        assertThat(web.path("nextCursor").isNull()).isTrue();
    }

    @Test
    void harnessRejectionEndsTheOperationWithoutRetrying() throws Exception {
        String tenant = tenant();
        String session = session(tenant);
        ActionJournal action = action(tenant, session, System.currentTimeMillis(), 9007199254740991L);
        AtomicInteger attempts = new AtomicInteger();
        DaemonHttpException rejected =
                mock(
                        DaemonHttpException.class,
                        call ->
                                "getStatusCode".equals(call.getMethod().getName())
                                        ? 400
                                        : RETURNS_DEFAULTS.answer(call));
        responses.put(
                action.id,
                call -> {
                    attempts.incrementAndGet();
                    throw rejected;
                });
        String op =
                json.readTree(
                                mvc.perform(
                                                auth(
                                                                post(path(session, action.id) + "/responses"),
                                                                tenant,
                                                                "owner")
                                                        .header("Idempotency-Key", "rejected")
                                                        .contentType(MediaType.APPLICATION_JSON)
                                                        .content(response("allow")))
                                        .andExpect(status().isAccepted())
                                        .andReturn()
                                        .getResponse()
                                        .getContentAsString())
                        .path("id")
                        .asText();
        await().atMost(Duration.ofSeconds(5))
                .untilAsserted(
                        () ->
                                assertThat(
                                                sessions.findOperation(tenant, session, op)
                                                        .orElseThrow()
                                                        .state())
                                        .isEqualTo("FAILED"));
        JsonNode result =
                read(
                        auth(
                                get("/v1/agents/sessions/{session}/operations/{op}", session, op),
                                tenant,
                                "owner"));
        assertThat(result.path("failure_code").asText()).isEqualTo("invalid_action_response");
        // Several scan intervals later the Harness was still asked only once.
        Thread.sleep(300);
        assertThat(attempts.get()).isEqualTo(1);
        assertThat(actions.find(tenant, session, action.id).orElseThrow().state())
                .isEqualTo("requested");
    }

    @Test
    void crashedWorkersLeaseIsReclaimed() throws Exception {
        String tenant = tenant();
        String session = session(tenant);
        ActionJournal action = action(tenant, session, System.currentTimeMillis(), 9007199254740991L);
        responses.put(
                action.id,
                call -> {
                    action.change("decided", call.getArgument(3));
                    return null;
                });
        // Admitted for a later time, so no worker claims it before it is handed to a dead one.
        String op =
                actions.admit(
                                tenant,
                                session,
                                "owner",
                                "sha256:owner",
                                "crashed",
                                "sha256:crashed",
                                action.id,
                                decision("allow"),
                                System.currentTimeMillis() + 3_600_000)
                        .operation()
                        .operationId();
        assertThat(
                        jdbc.update(
                                "UPDATE managed_agent_operation SET state = 'RUNNING', delivery_state ="
                                        + " 'LEASED', lease_owner = 'crashed-worker', lease_until = 1,"
                                        + " claim_generation = 1 WHERE operation_id = ? AND"
                                        + " delivery_state = 'PENDING'",
                                op))
                .isEqualTo(1);
        await().atMost(Duration.ofSeconds(5))
                .untilAsserted(
                        () ->
                                assertThat(
                                                sessions.findOperation(tenant, session, op)
                                                        .orElseThrow()
                                                        .state())
                                        .isEqualTo("COMPLETED"));
        assertThat(actions.find(tenant, session, action.id).orElseThrow().state())
                .isEqualTo("decided");
    }

    @Test
    void lifecycleWorkerNeverSeesActionResponses() throws Exception {
        String tenant = tenant();
        String session = session(tenant);
        ActionJournal action = action(tenant, session, System.currentTimeMillis(), 9007199254740991L);
        long now = System.currentTimeMillis();
        // Admitted for a later time, so the Action worker leaves it alone.
        String op =
                actions.admit(
                                tenant,
                                session,
                                "owner",
                                "sha256:owner",
                                "outbox",
                                "sha256:outbox",
                                action.id,
                                decision("allow"),
                                now + 3_600_000)
                        .operation()
                        .operationId();
        // The lifecycle worker closes the Session of every operation it claims.
        assertThat(sessions.findDeliverableOperations(now + 7_200_000, 1000))
                .noneMatch(target -> target.operationId().equals(op));
        assertThat(
                        jdbc.update(
                                "UPDATE managed_agent_operation SET state = 'RUNNING', delivery_state ="
                                        + " 'LEASED', lease_owner = 'another-server', lease_until = ?,"
                                        + " claim_generation = 1 WHERE operation_id = ?",
                                now + 3_600_000,
                                op))
                .isEqualTo(1);
        assertThat(sessions.findDeliverableOperations(now + 7_200_000, 1000))
                .noneMatch(target -> target.operationId().equals(op));
    }

    private void assertRejected(org.assertj.core.api.ThrowableAssert.ThrowingCallable change) {
        assertThatThrownBy(change)
                .isInstanceOfSatisfying(
                        ApiException.class,
                        error ->
                                assertThat(error.getCode())
                                        .isEqualTo("managed_session_action_rejected"));
    }

    private ObjectNode decision(String option) {
        return json.createObjectNode()
                .put("optionId", option)
                .put("inputRevision", 1)
                .put("policyRevision", "hosted-tool-approval/1");
    }

    private ActionJournal action(String tenant, String session, long created, long expiry)
            throws Exception {
        ActionJournal journal = new ActionJournal(journals, tenant, session, created, expiry);
        journal.change("requested", null);
        return journal;
    }

    private String session(String tenant) throws Exception {
        String session =
                json.readTree(
                                mvc.perform(
                                                post("/v1/agents/sessions")
                                                        .header(TenantContextFilter.HEADER, tenant)
                                                        .header(
                                                                "Idempotency-Key",
                                                                UUID.randomUUID().toString())
                                                        .contentType(MediaType.APPLICATION_JSON)
                                                        .content(
                                                                "{\"agent_id\":\"qwen-code\",\"input\":[]}"))
                                        .andExpect(status().isAccepted())
                                        .andReturn()
                                        .getResponse()
                                        .getContentAsString())
                        .path("id")
                        .asText();
        jdbc.update(
                "INSERT INTO managed_workspace_create_command (tenant_id, actor_id,"
                        + " idempotency_key, request_digest, session_id, created_at) VALUES (?, ?, ?,"
                        + " ?, ?, ?)",
                tenant,
                "owner".getBytes(StandardCharsets.UTF_8),
                UUID.randomUUID().toString(),
                "sha256:test",
                session,
                System.currentTimeMillis());
        return session;
    }

    private JsonNode read(MockHttpServletRequestBuilder request) throws Exception {
        return json.readTree(
                mvc.perform(request)
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString());
    }

    private MockHttpServletRequestBuilder auth(
            MockHttpServletRequestBuilder request, String tenant, String actor) {
        return request.header(TenantContextFilter.HEADER, tenant)
                .principal(
                        new AuthenticatedTenantActor() {
                            public String tenantId() {
                                return tenant;
                            }

                            public String actorId() {
                                return actor;
                            }

                            public String getName() {
                                return actor;
                            }
                        });
    }

    private static String path(String session, String action) {
        return "/v1/agents/sessions/" + session + "/actions/" + action;
    }

    private static String tenant() {
        return "actions-" + UUID.randomUUID();
    }

    private static String response(String option) {
        return "{\"kind\":\"permission\",\"input_revision\":1,\"policy_revision\":\"hosted-tool-approval/1\",\"option_id\":\""
                + option
                + "\"}";
    }
}
