package com.alibaba.qwen.code.managedagent;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.alibaba.qwen.code.managedagent.api.AuthenticatedTenantActor;
import com.alibaba.qwen.code.managedagent.api.TenantContextFilter;
import com.alibaba.qwen.code.managedagent.harness.HarnessConnector.SourceEvent;
import com.alibaba.qwen.code.managedagent.service.HarnessEventProjector;
import com.alibaba.qwen.code.managedagent.store.ManagedArtifactReader;
import com.alibaba.qwen.code.managedagent.store.ManagedToolResultProjector;
import com.alibaba.qwen.code.managedagent.store.ToolPublicationDataStore;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * PR #13330 verification probe (not part of the PR). Drives a harness tool_call
 * through the production HarnessEventProjector and a published tool result
 * through the production ManagedToolResultProjector into the same H2-backed
 * ManagedAgentStore, then reads the public item list (after the snapshot
 * converges) and the public tool-result route. Prints PROBE lines instead of
 * asserting so both arms report.
 */
class Pr13330ToolItemIdentityProbe extends ManagedArtifactApiIntegrationTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String TURN = "turn_public_1";

    @Test
    void lateHarnessUpdateAfterPublishedResult() throws Exception {
        String resultItem = itemId;
        String callItem = appendHarnessToolCall(41L, "tool_call_update", "model-1", "completed");
        report("A_late_update", resultItem, callItem);
    }

    @Test
    void harnessCallFirstThenPublishedResult() throws Exception {
        // Production order: the harness streams the tool_call before the
        // Session Store publication is projected. Rewind only the projected
        // result (event, artifacts, items) and replay in that order.
        var jdbc = fixture.jdbc();
        jdbc.update("DELETE FROM managed_agent_artifact");
        jdbc.update("DELETE FROM managed_agent_event WHERE event_type = 'item.tool_result.updated'");
        jdbc.update("DELETE FROM managed_agent_item_part");
        jdbc.update("DELETE FROM managed_agent_item");
        jdbc.update("UPDATE managed_agent_consumer_progress SET covered_sequence = (SELECT last_sequence"
                + " FROM managed_agent_session WHERE session_id = 'session-1')");
        jdbc.update("UPDATE managed_agent_tool_result SET work_state = 'PENDING', next_attempt_at = 0");
        String callItem = appendHarnessToolCall(40L, "tool_call", "model-1", "in_progress");
        var beans = new org.springframework.beans.factory.support.StaticListableBeanFactory();
        beans.addBean("publication", fixture.publications());
        var provider = beans.getBeanProvider(ToolPublicationDataStore.class);
        new ManagedToolResultProjector(fixture.results(), jdbc, provider,
                new ManagedArtifactReader(provider), fixture.policy(), fixture.properties())
                .project(fixture.results().claim().orElseThrow());
        materialize();
        String resultItem = jdbc.queryForObject("SELECT item_id FROM managed_agent_tool_result", String.class);
        report("B_call_first", resultItem, callItem);
    }

    @Test
    void turnInFlightAcrossTheUpgrade() throws Exception {
        // A Turn whose tool_call was projected and stored by the previous
        // server build and whose tool_call_update arrives after the restart.
        // The base arm records its own projection of the first event; the head
        // arm appends that stored record verbatim, then projects the update.
        Path legacy = Path.of(System.getProperty("probe.legacy", "/tmp/pr13330-legacy-tool-call.json"));
        var update = Map.<String, Object>of("sessionUpdate", "tool_call", "toolCallId", "model-2",
                "status", "in_progress", "title", "read_file");
        var first = new HarnessEventProjector().project(new SourceEvent(50L, "session_update",
                Map.of("update", update), null, Map.of()), TURN);
        Map<String, Object> stored = first.data();
        if (Boolean.getBoolean("probe.recordLegacy")) {
            Files.writeString(legacy, JSON.writeValueAsString(first.data()));
        } else {
            stored = JSON.readValue(Files.readString(legacy), new TypeReference<Map<String, Object>>() { });
        }
        System.out.println("PROBE C_upgrade stored_tool_call_data=" + JSON.writeValueAsString(stored));
        fixture.sessions().appendPublicEventIfAbsent("tenant-1", "session-1", TURN,
                "item.tool_call.updated", stored, false, "probe-harness-50");
        materialize();
        String after = appendHarnessToolCall(51L, "tool_call_update", "model-2", "completed");
        System.out.println("PROBE C_upgrade stored_item=" + stored.get("itemId") + " update_item=" + after
                + " same_item=" + after.equals(stored.get("itemId")));
        converge();
        for (var item : sessions.listPublicItems("tenant-1", "reader", "session-1", 0, 100).data()) {
            if ("model-2".equals(item.attributes().get("toolCallId"))) {
                System.out.println("PROBE C_upgrade public_item id=" + item.id() + " status=" + item.status());
            }
        }
    }

    private String appendHarnessToolCall(long sourceId, String kind, String callId, String status) {
        // Same shape the Hosted Harness streams for a tool call: ACP
        // session_update with toolCallId = the model's function-call id, which
        // the Workspace tool turn also records as the publication modelCallId.
        var update = Map.<String, Object>of("sessionUpdate", kind,
                "toolCallId", callId, "status", status, "title", "run_shell_command");
        var source = new SourceEvent(sourceId, "session_update", Map.of("update", update), null, Map.of());
        var projected = new HarnessEventProjector().project(source, TURN);
        fixture.sessions().appendPublicEventIfAbsent("tenant-1", "session-1", TURN,
                projected.type(), projected.data(), false, "probe-harness-" + sourceId);
        materialize();
        return (String) projected.data().get("itemId");
    }

    private void materialize() {
        new TransactionTemplate(fixture.manager()).executeWithoutResult(ignored ->
                fixture.sessions().materializeNextBatch("tenant-1", "session-1", 100));
    }

    // Equivalent to waiting out SNAPSHOT_REFRESH_MILLIS: age the snapshot so the
    // next drained pass rewrites it, as the background materializer would.
    private void converge() {
        fixture.jdbc().update("UPDATE managed_agent_snapshot SET updated_at = 0");
        materialize();
    }

    private void report(String scenario, String resultItem, String callItem) throws Exception {
        System.out.println("PROBE " + scenario + " harness_call_item_id=" + callItem);
        System.out.println("PROBE " + scenario + " published_result_item_id=" + resultItem);
        System.out.println("PROBE " + scenario + " same_item=" + callItem.equals(resultItem));
        converge();
        var items = sessions.listPublicItems("tenant-1", "reader", "session-1", 0, 100).data();
        System.out.println("PROBE " + scenario + " public_items=" + items.size());
        for (var item : items) {
            JsonNode attributes = JSON.valueToTree(item.attributes());
            System.out.println("PROBE " + scenario + " public_item id=" + item.id() + " type=" + item.type()
                    + " status=" + item.status() + " toolCallId=" + attributes.path("toolCallId").asText()
                    + " has_call_fields=" + attributes.has("kind")
                    + " has_result=" + attributes.path("result").isObject());
        }
        for (var entry : List.of(Map.entry("call_item", callItem), Map.entry("result_item", resultItem))) {
            var response = mvc.perform(reader(get("/v1/agents/sessions/session-1/items/" + entry.getValue()
                    + "/tool-result"))).andReturn().getResponse();
            JsonNode body = JSON.readTree(response.getContentAsString());
            System.out.println("PROBE " + scenario + " GET /items/<" + entry.getKey() + ">/tool-result -> HTTP "
                    + response.getStatus() + (response.getStatus() == 200
                            ? " execution_status=" + body.at("/result/execution_status").asText()
                            : " error.code=" + body.at("/error/code").asText()));
        }
    }

    private static MockHttpServletRequestBuilder reader(MockHttpServletRequestBuilder request) {
        return request.header(TenantContextFilter.HEADER, "tenant-1").principal(new AuthenticatedTenantActor() {
            public String getName() { return "reader"; }
            public String tenantId() { return "tenant-1"; }
            public String actorId() { return "reader"; }
        });
    }
}
