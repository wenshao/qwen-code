package com.alibaba.qwen.code.managedagent;

import com.alibaba.qwen.code.managedagent.api.ApiException;
import com.alibaba.qwen.code.managedagent.store.ManagedExtensionRecordStore;
import com.alibaba.qwen.code.managedagent.store.ManagedSessionStore;
import com.alibaba.qwen.code.managedagent.store.ManagedSessionStoreModels.CommitResource;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Maintainer probe for PR #13548, run identically against the base build and
 * the PR build: commits channel_delivery revisions through the real
 * ManagedSessionStore commit path (Spring context, H2 in MySQL mode).
 */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:channel-probe;"
                + "MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "qwen.managed-agent.harness.enabled=false"
})
class ChannelStoreProbeTest {
    private static final String TENANT = "tenant-probe";
    private static final String WORKSPACE = "workspace-probe";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    @Autowired
    private ManagedSessionStore sessionStore;

    @Autowired
    private ManagedExtensionRecordStore records;

    @Autowired
    private JdbcTemplate jdbc;

    private long clock = 1_000;

    private static CommitResource res(String id, String kind, String text) {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        return new CommitResource(id, kind, 1, bytes.length, ExtensionRecordJournal.sha256(bytes),
                Base64.getEncoder().encodeToString(bytes));
    }

    private static ObjectNode ref(CommitResource r) {
        return F.objectNode().put("resourceId", r.resourceId()).put("kind", r.kind())
                .put("schemaVersion", r.schemaVersion()).put("byteLength", r.byteLength()).put("digest", r.digest());
    }

    private static ObjectNode receipt(String id) {
        ObjectNode n = F.objectNode().put("providerMessageId", id).put("acceptedAt", 1_750_000_000_000L);
        n.putNull("proofRef");
        return n;
    }

    private final CommitResource result = res("result-1", "managed-tool-result", "{\"text\":\"ok\"}");
    private final CommitResource seg1 = res("seg-1-data", "channel-delivery-segment", "part one");
    private final CommitResource seg2 = res("seg-2-data", "channel-delivery-segment", "part two");

    private ObjectNode delivery(ObjectNode r1, ObjectNode r2, String runState, String line) {
        ObjectNode d = F.objectNode().put("deliveryId", "delivery-1").put("routeId", "route-1")
                .put("routeRevision", 3).put("sourceTurnId", "turn-1");
        d.set("contentRef", ref(result));
        var segments = d.putArray("segments");
        int i = 0;
        for (CommitResource s : List.of(seg1, seg2)) {
            ObjectNode seg = segments.addObject().put("segmentId", "seg-" + (i + 1)).put("ordinal", i);
            seg.set("contentRef", ref(s));
            seg.set("receipt", i == 0 ? (r1 == null ? F.nullNode() : r1) : (r2 == null ? F.nullNode() : r2));
            i++;
        }
        d.put("cancelRequested", false);
        ObjectNode run = d.putObject("run").put("state", runState);
        run.putNull("reason"); run.putNull("definition"); run.putNull("executionCallId");
        run.put("effectId", "delivery-1"); run.putNull("dispatchId"); run.put("deliveryId", "delivery-1");
        run.putNull("execution"); run.putNull("runtime");
        run.putObject("delivery").put("target", "channel").put("state", line);
        return d;
    }

    private String commit(ExtensionRecordJournal journal, String command, JsonNode body, List<CommitResource> resources) {
        try {
            var tx = journal.requestDomain(command, "channel_delivery", body, resources, clock += 1_000);
            journal.commit(tx);
            journal.committed(tx);
            return "ACCEPTED";
        } catch (ApiException e) {
            return "REFUSED " + e.getStatus().value() + " " + e.getCode() + ": " + e.getMessage();
        } catch (RuntimeException e) {
            return "REFUSED " + e.getClass().getSimpleName() + ": " + e.getMessage();
        }
    }

    private String indexed(String sessionId) {
        List<String> rows = jdbc.query("SELECT domain, revision FROM qwen_managed_session_extension_record"
                        + " WHERE tenant_id = ? AND session_id = ?",
                (r, n) -> r.getString(1) + "@rev" + r.getLong(2), TENANT, sessionId);
        String latest;
        try {
            List<JsonNode> list = records.listRecords(TENANT, sessionId, "channel_delivery");
            latest = list.isEmpty() ? "none" : list.get(0).at("/run/delivery/state").textValue();
        } catch (RuntimeException e) {
            latest = e.getClass().getSimpleName() + ": " + e.getMessage();
        }
        return "extension-record rows=" + rows + " listRecords(channel_delivery) latest line=" + latest;
    }

    private ExtensionRecordJournal journal(String sessionId) {
        return new ExtensionRecordJournal(sessionStore, TENANT, WORKSPACE, sessionId).open();
    }

    @Test
    void probe() {
        List<String> out = new ArrayList<>();
        // A. the decision-5 bypass chain
        String s1 = UUID.randomUUID().toString();
        ExtensionRecordJournal j1 = journal(s1);
        Object[][] steps = {
            {"planned", delivery(null, null, "admitted", "planned")},
            {"sending", delivery(null, null, "running", "sending")},
            {"sending, seg-1 proven", delivery(receipt("m-1"), null, "running", "sending")},
            {"unknown (seg-2 fate unknown)", delivery(receipt("m-1"), null, "waiting", "unknown")},
            {"partial, NO new receipt", delivery(receipt("m-1"), null, "running", "partial")},
            {"sending again (seg-2 re-sent)", delivery(receipt("m-1"), null, "running", "sending")},
            {"delivered (seg-2 twice)", delivery(receipt("m-1"), receipt("m-2-dup"), "settled", "delivered")},
        };
        for (int n = 0; n < steps.length; n++) {
            out.add(String.format("A%d %-30s -> %s", n + 1, steps[n][0],
                    commit(j1, "a-" + n, (JsonNode) steps[n][1], n == 0 ? List.of(result, seg1, seg2) : List.of())));
        }
        out.add("A  " + indexed(s1));
        // B. the direct step the corpus pins
        String s2 = UUID.randomUUID().toString();
        ExtensionRecordJournal j2 = journal(s2);
        for (int n = 0; n < 4; n++) {
            commit(j2, "b-" + n, (JsonNode) steps[n][1], n == 0 ? List.of(result, seg1, seg2) : List.of());
        }
        out.add("B  direct unknown -> sending -> " + commit(j2, "b-direct", (JsonNode) steps[5][1], List.of()));
        // C. a body the contract refuses outright: delivered with seg-2 unproven
        String s3 = UUID.randomUUID().toString();
        ExtensionRecordJournal j3 = journal(s3);
        out.add("C  first revision 'delivered' with seg-2 receipt missing -> "
                + commit(j3, "c-0", delivery(receipt("m-1"), null, "settled", "delivered"), List.of(result, seg1, seg2)));
        out.add("C  " + indexed(s3));
        out.forEach(line -> System.out.println("PROBE " + line));
    }
}
