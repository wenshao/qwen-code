cat > $1/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/CancelReplayProbeTest.java <<'JAVA'
package com.alibaba.qwen.code.managedagent;

import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.alibaba.qwen.code.managedagent.ManagedAgentServerIntegrationTest.FixtureHarness;
import com.alibaba.qwen.code.managedagent.api.TenantContextFilter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:cancel-replay;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "qwen.managed-agent.harness.enabled=false",
        "qwen.managed-agent.dispatch.scan-delay=50ms",
        "qwen.managed-agent.events.poll-interval=10ms",
        "qwen.managed-agent.events.materialize-interval=10ms"})
@AutoConfigureMockMvc
@Import(ManagedAgentServerIntegrationTest.FixtureConfiguration.class)
class CancelReplayProbeTest {
    private static final String T = TenantContextFilter.HEADER;
    private static final String WS = "/api/agent/web-shell/v1";
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper json;
    @Autowired private FixtureHarness harness;

    private MockHttpServletResponse call(MockHttpServletRequestBuilder r, String body) throws Exception {
        if (body != null) { r.contentType(MediaType.APPLICATION_JSON).content(body); }
        return mvc.perform(r.header(T, "tenant-replay")).andReturn().getResponse();
    }

    private void show(String label, MockHttpServletResponse r) throws Exception {
        System.out.println("PROBE " + label + " -> " + r.getStatus() + " "
                + r.getContentAsString(StandardCharsets.UTF_8));
    }

    @Test
    void retryTurnCancelAfterSettle() throws Exception {
        String sid = json.readTree(call(post(WS + "/sessions/create"),
                "{\"idempotencyKey\":\"c\",\"agentId\":\"qwen-code\",\"input\":[]}")
                .getContentAsString()).get("sessionId").asText();
        MockHttpServletResponse submit = call(post(WS + "/turns/submit"),
                "{\"idempotencyKey\":\"s\",\"sessionId\":\"%s\",\"input\":[{\"type\":\"text\",\"text\":\"hold\"}]}".formatted(sid));
        String turn = json.readTree(submit.getContentAsString()).get("turnId").asText();
        await().atMost(Duration.ofSeconds(5)).until(harness::hasHeldTurn);
        int cancels = harness.cancelCount();
        String cancel = "{\"idempotencyKey\":\"%s\",\"sessionId\":\"%s\",\"turnId\":\"%s\"}";
        show("webshell cancel #1 key=K (turn running)", call(post(WS + "/turns/cancel"), cancel.formatted("K", sid, turn)));
        await().atMost(Duration.ofSeconds(5)).until(() -> harness.cancelCount() > cancels);
        harness.releaseHeldTurns();
        await().atMost(Duration.ofSeconds(5)).until(() -> {
            JsonNode s = json.readTree(call(get("/v1/agents/sessions/{id}", sid), null).getContentAsString());
            return !s.has("active_turn");
        });
        JsonNode session = json.readTree(call(post(WS + "/sessions/get"), "{\"sessionId\":\"%s\"}".formatted(sid)).getContentAsString());
        System.out.println("PROBE turn settled: activeTurn.status=" + session.path("activeTurn").path("status").asText() + " (public active_turn absent)");
        show("webshell cancel #2 same key=K (turn settled)", call(post(WS + "/turns/cancel"), cancel.formatted("K", sid, turn)));
        show("webshell cancel #3 new key=K2 (turn settled)", call(post(WS + "/turns/cancel"), cancel.formatted("K2", sid, turn)));
    }
}
JAVA
