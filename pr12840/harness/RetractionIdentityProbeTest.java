package com.alibaba.qwen.code.managedagent;

import static org.assertj.core.api.Assertions.assertThat;

import com.alibaba.qwen.code.managedagent.store.ManagedAgentStore;
import com.alibaba.qwen.code.managedagent.store.StoreModels.Admission;
import com.alibaba.qwen.code.managedagent.store.StoreModels.EventRecord;
import com.alibaba.qwen.code.managedagent.store.StoreModels.HarnessEvent;
import com.alibaba.qwen.code.managedagent.store.StoreModels.ItemPartRecord;
import com.alibaba.qwen.code.managedagent.store.StoreModels.ItemRecord;
import com.alibaba.qwen.code.managedagent.store.StoreModels.ProjectedEvent;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/**
 * Rig probe for PR 12840 (not for merge): randomized Turns whose deltas come
 * from several Harness generations, one generation retracted, then the
 * Snapshot rebuilt; every stored identity must name the rebuilt Snapshot and
 * the deltas of each Part must rebuild its text.
 */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:retraction-probe;MODE=MySQL;"
                + "DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "qwen.managed-agent.harness.enabled=false",
        "qwen.managed-agent.dispatch.scan-delay=1h",
        "qwen.managed-agent.events.poll-interval=1h",
        "qwen.managed-agent.events.materialize-interval=1h"
})
@AutoConfigureMockMvc
@Import(ManagedAgentServerIntegrationTest.FixtureConfiguration.class)
class RetractionIdentityProbeTest {
    private static final String[] PREFIXES = {"boot_old:epoch_old:",
            "boot_kept:epoch_old:", "boot_other:epoch_old:"};

    @Autowired
    private ManagedAgentStore store;

    @Test
    void randomizedRetractionsKeepIdentitiesOnTheRebuiltSnapshot() {
        long seed = Long.getLong("probe.seed", 12840L);
        int cases = Integer.getInteger("probe.cases", 400);
        Random random = new Random(seed);
        List<String> failures = new ArrayList<>();
        int retracted = 0;
        int continuedAfterRetracted = 0;
        for (int c = 0; c < cases; c++) {
            String tenant = "probe-" + seed + "-" + c;
            Admission session = store.insertSessionCommand(tenant,
                    "CREATE_SESSION", "probe-create-" + c,
                    "sha256:" + "7".repeat(64), "qwen-code", null, null,
                    List.of(), null);
            String sessionId = session.sessionId();
            Admission turn = store.insertTurnCommand(tenant, "SUBMIT_TURN",
                    "probe-turn-" + c, "sha256:" + "8".repeat(64), sessionId,
                    List.of(), "sha256:" + "9".repeat(64));
            String owner = "probe-owner";
            store.claimTurn(tenant, sessionId, turn.turnId(), owner,
                    Duration.ofMinutes(5)).orElseThrow();
            store.bindHarness(tenant, sessionId, turn.turnId(), owner,
                    "boot_old");
            store.markSubmissionAttempted(tenant, sessionId, turn.turnId(),
                    owner);
            store.recordAdmission(tenant, sessionId, turn.turnId(), owner,
                    "epoch_old", 1);
            int count = 2 + random.nextInt(18);
            long source = 1;
            List<HarnessEvent> pending = new ArrayList<>();
            String previousPrefix = null;
            String previousType = null;
            for (int i = 0; i < count; i++) {
                String prefix = PREFIXES[random.nextInt(PREFIXES.length)];
                int kind = random.nextInt(10);
                String type = kind < 6 ? "item.output_text.delta"
                        : kind < 9 ? "item.reasoning.delta"
                                : "item.tool_call.updated";
                Map<String, Object> data = new LinkedHashMap<>();
                if (type.endsWith(".delta")) {
                    data.put("text", random.nextInt(12) == 0 ? ""
                            : prefix.substring(5, 8) + (i + 1) + ";");
                } else {
                    data.put("toolCallId", "call_" + random.nextInt(2));
                    data.put("status", "in_progress");
                }
                if (PREFIXES[0].equals(previousPrefix)
                        && !PREFIXES[0].equals(prefix)
                        && type.equals(previousType)) {
                    continuedAfterRetracted++;
                }
                previousPrefix = prefix;
                previousType = type;
                source++;
                pending.add(new HarnessEvent(source, prefix + source,
                        new ProjectedEvent(type, Map.copyOf(data), false,
                                null, null, null)));
                if (random.nextInt(4) == 0 || i == count - 1) {
                    store.recordHarnessEvents(tenant, sessionId,
                            turn.turnId(), owner, "epoch_old",
                            List.copyOf(pending));
                    pending.clear();
                }
                if (random.nextInt(6) == 0) {
                    store.materializeNextBatch(tenant, sessionId, 1000);
                }
            }
            store.retractContinuationOutput(tenant, sessionId, turn.turnId(),
                    owner, "boot_old", "epoch_old");
            retracted++;
            store.materializeNextBatch(tenant, sessionId, 1000);
            String problem = check(tenant, sessionId);
            if (problem != null) {
                failures.add("case " + c + ": " + problem);
            }
        }
        System.out.printf("PROBE seed=%d cases=%d retracted=%d"
                        + " keptAfterRetractedSameType=%d failures=%d%n",
                seed, cases, retracted, continuedAfterRetracted,
                failures.size());
        failures.stream().limit(10).forEach(f -> System.out.println(
                "PROBE " + f));
        assertThat(failures).isEmpty();
    }

    private String check(String tenant, String sessionId) {
        List<ItemRecord> items = store.findSnapshot(tenant, sessionId)
                .orElseThrow().items();
        List<EventRecord> events = store.findEvents(tenant, sessionId, 0,
                1000);
        Map<String, StringBuilder> rebuilt = new LinkedHashMap<>();
        for (EventRecord event : events) {
            boolean delta = event.type().endsWith(".delta");
            Object text = event.data().get("text");
            if (delta && "".equals(text)
                    && (event.itemId() != null
                            || event.contentPartId() != null)) {
                return "#" + event.sequence() + " empty delta names "
                        + event.contentPartId();
            }
            if (event.itemId() == null) {
                if (delta && text instanceof String s && !s.isEmpty()) {
                    return "#" + event.sequence() + " text delta has no"
                            + " identity";
                }
                continue;
            }
            ItemRecord item = items.stream().filter(candidate ->
                    candidate.itemId().equals(event.itemId())).findFirst()
                    .orElse(null);
            if (item == null) {
                return "#" + event.sequence() + " names missing Item "
                        + event.itemId();
            }
            if (event.contentPartId() == null) {
                continue;
            }
            ItemPartRecord part = item.content().stream().filter(p ->
                    p.partId().equals(event.contentPartId())).findFirst()
                    .orElse(null);
            if (part == null) {
                return "#" + event.sequence() + " names missing Part "
                        + event.contentPartId() + " of " + describe(events);
            }
            rebuilt.computeIfAbsent(event.contentPartId(),
                    ignored -> new StringBuilder()).append(text);
        }
        for (ItemRecord item : items) {
            for (ItemPartRecord part : item.content()) {
                if (!"output_text".equals(part.type())
                        && !"reasoning".equals(part.type())) {
                    continue;
                }
                StringBuilder text = rebuilt.get(part.partId());
                if (text == null || !text.toString().equals(part.text())) {
                    return "Part " + part.partId() + " text '" + part.text()
                            + "' but its deltas give '" + text + "' in "
                            + describe(events);
                }
            }
        }
        return null;
    }

    private static String describe(List<EventRecord> events) {
        StringBuilder out = new StringBuilder();
        for (EventRecord event : events) {
            if (!event.type().startsWith("item.")) {
                continue;
            }
            out.append(event.sequence()).append(':')
                    .append(event.type().contains("reasoning") ? "R"
                            : event.type().contains("tool") ? "T" : "O")
                    .append('[').append(event.sourceKey() == null ? "-"
                            : event.sourceKey().substring(5, 8))
                    .append(']').append(event.data().get("text"))
                    .append("->").append(event.contentPartId() == null
                            ? "-" : event.contentPartId().replaceAll(
                                    ".*_", ""))
                    .append(' ');
        }
        return out.toString();
    }
}
