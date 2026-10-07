package com.alibaba.qwen.code.managedagent;

import com.alibaba.qwen.code.managedagent.api.ApiException;
import com.alibaba.qwen.code.managedagent.store.ManagedExtensionRecordStore;
import com.alibaba.qwen.code.managedagent.store.ManagedSessionStore;
import com.alibaba.qwen.code.managedagent.store.ManagedSessionStoreModels.CommitResource;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/** Maintainer probe for PR #13548 review R1-1: channel bodies whose refs name no stored resource. */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:channel-resource-probe;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa",
        "spring.datasource.password=", "qwen.managed-agent.harness.enabled=false"})
class ChannelResourceProbeTest {
    private static final String TENANT = "tenant-probe";
    @Autowired private ManagedSessionStore sessionStore;
    @Autowired private ManagedExtensionRecordStore records;
    @Autowired private JdbcTemplate jdbc;

    private static CommitResource res(String id, String kind, String text) {
        byte[] b = text.getBytes(StandardCharsets.UTF_8);
        return new CommitResource(id, kind, 1, b.length, ExtensionRecordJournal.sha256(b), Base64.getEncoder().encodeToString(b));
    }

    private static ObjectNode ref(CommitResource r) {
        return JsonNodeFactory.instance.objectNode().put("resourceId", r.resourceId()).put("kind", r.kind())
                .put("schemaVersion", r.schemaVersion()).put("byteLength", r.byteLength()).put("digest", r.digest());
    }

    private String commit(String domain, JsonNode body, List<CommitResource> resources, String... ids) {
        String session = UUID.randomUUID().toString();
        ExtensionRecordJournal journal = new ExtensionRecordJournal(sessionStore, TENANT, "workspace-probe", session).open();
        String outcome;
        try {
            var tx = journal.requestDomain("c-1", domain, body, resources, 1_000);
            journal.commit(tx);
            journal.committed(tx);
            outcome = "ACCEPTED";
        } catch (ApiException e) {
            outcome = "REFUSED " + e.getStatus().value() + " " + e.getCode() + ": " + e.getMessage();
        }
        int stored = 0;
        for (String id : ids) {
            stored += jdbc.queryForObject("SELECT COUNT(*) FROM qwen_managed_session_resource WHERE session_id = ? AND resource_id = ?",
                    Integer.class, session, id);
        }
        int rows = jdbc.queryForObject("SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id = ?", Integer.class, session);
        return outcome + " | referenced resources stored=" + stored + "/" + ids.length + " | extension-record rows=" + rows;
    }

    @Test
    void probe() throws Exception {
        JsonNode channel = ManagedChannelRecordContractTest.fixtures().get("templates");
        CommitResource policy = res("policy-x", "channel-policy", "{}");
        ObjectNode route = channel.get("channel_route").deepCopy();
        route.set("policyRef", ref(policy));
        System.out.println("PROBE route, policyRef resource NOT sent      -> " + commit("channel_route", route, List.of(), "policy-x"));
        System.out.println("PROBE route, policyRef resource sent          -> " + commit("channel_route", route, List.of(policy), "policy-x"));
        CommitResource result = res("result-x", "managed-tool-result", "{}");
        CommitResource s1 = res("seg-1-x", "channel-delivery-segment", "a");
        CommitResource s2 = res("seg-2-x", "channel-delivery-segment", "b");
        ObjectNode delivery = channel.get("channel_delivery").deepCopy();
        delivery.set("contentRef", ref(result));
        ((ObjectNode) delivery.get("segments").get(0)).set("contentRef", ref(s1));
        ((ObjectNode) delivery.get("segments").get(1)).set("contentRef", ref(s2));
        System.out.println("PROBE delivery, no referenced resource sent   -> " + commit("channel_delivery", delivery, List.of(), "result-x", "seg-1-x", "seg-2-x"));
        // Control: an older Stage H body with the same omission.
        JsonNode hooks = ManagedHookRecordContractTest.fixtures().get("templates");
        CommitResource catalog = res("hook-catalog-x", "hook-data", "{}");
        ObjectNode registration = hooks.get("hook_registration").deepCopy();
        registration.set("catalogRef", ref(catalog));
        System.out.println("PROBE control hook_registration, catalog NOT sent -> " + commit("hook_registration", registration, List.of(), "hook-catalog-x"));
    }
}
