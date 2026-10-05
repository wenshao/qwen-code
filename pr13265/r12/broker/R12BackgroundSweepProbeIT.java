package com.alibaba.qwen.code.runtimebroker;

import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;

/**
 * PR #13265 round 12 probe (local copy only, never committed): the Jdbc
 * findBackgroundProcesses that 17cf17ce54 added has no repository contract.
 * Same rows on InMemory and on real MySQL: background :process rows
 * interleaved with ordinary rows, some settled, some EXECUTING, plus rows of
 * other owners. Paged exactly as RuntimeBrokerService does, at several limits.
 */
class R12BackgroundSweepProbeIT {

    @Test
    void inMemory() {
        System.out.println("[R12-J9] inMemory " + probe(
                new InMemoryToolExecutionRepository(Clock.systemUTC()), "mem-" + UUID.randomUUID()));
    }

    @Test
    void mysql() {
        DataSource source = new DriverManagerDataSource(System.getProperty("mysql.url"),
                System.getProperty("mysql.user"), System.getProperty("mysql.password", ""));
        System.out.println("[R12-J9] mysql " + probe(new JdbcToolExecutionRepository(source),
                "my-" + UUID.randomUUID()));
    }

    private static String probe(ToolExecutionRepository repository, String prefix) {
        RuntimeScope scope = new RuntimeScope("tenant", "workspace", "generation",
                "/workspace", "capability", "session");
        RuntimeSessionRecord session = session(scope, prefix + "-harness", prefix + "-session",
                prefix + "-binding", 1);
        Set<String> expected = new HashSet<>();
        int settled = 0;
        int executing = 0;
        for (int i = 0; i < 260; i++) {
            boolean background = i % 2 == 0;
            ToolExecutionRecord record = repository.findOrCreate(record(session, prefix + "-" + i, background));
            if (!background) {
                continue;
            }
            if (i % 26 == 0) {
                // a settled background row must never be swept
                ToolExecutionRecord claimed = repository.claimDispatch(record.getExecutionCallId(),
                        "owner", Duration.ofMinutes(10));
                ToolExecutionRecord done = repository.compareAndSet(claimed,
                        claimed.withResult(Map.of("executionStatus", "success"), 0, Instant.now()),
                        "owner", claimed.getDispatchGeneration());
                assertNotNull(done);
                settled++;
                continue;
            }
            if (i % 10 == 4) {
                // an EXECUTING background row is still alive and must be swept
                ToolExecutionRecord claimed = repository.claimDispatch(record.getExecutionCallId(),
                        "owner", Duration.ofMinutes(10));
                assertNotNull(repository.compareAndSet(claimed,
                        claimed.withState(ToolExecutionRecord.State.EXECUTING, false),
                        "owner", claimed.getDispatchGeneration()));
                executing++;
            }
            expected.add(record.getExecutionCallId());
        }
        // background rows of other owners: another harness, session, binding, generation
        String[][] foreign = {
            {prefix + "-other-harness", prefix + "-session", prefix + "-binding", "1"},
            {prefix + "-harness", prefix + "-other-session", prefix + "-binding", "1"},
            {prefix + "-harness", prefix + "-session", prefix + "-other-binding", "1"},
            {prefix + "-harness", prefix + "-session", prefix + "-binding", "2"},
        };
        for (int i = 0; i < foreign.length; i++) {
            RuntimeSessionRecord other = session(scope, foreign[i][0], foreign[i][1], foreign[i][2],
                    Long.parseLong(foreign[i][3]));
            repository.findOrCreate(record(other, prefix + "-foreign-" + i, true));
        }
        StringBuilder out = new StringBuilder("{\"expected\":" + expected.size()
                + ",\"settledExcluded\":" + settled + ",\"executingIncluded\":" + executing);
        for (int limit : new int[] {100, 7, 1}) {
            Set<String> seen = new HashSet<>();
            List<Integer> pages = new ArrayList<>();
            int duplicates = 0;
            int strangers = 0;
            String after = null;
            for (int guard = 0; guard < 1000; guard++) {
                List<ToolExecutionRecord> batch = repository.findBackgroundProcesses(session, after, limit);
                pages.add(batch.size());
                for (ToolExecutionRecord row : batch) {
                    if (!seen.add(row.getExecutionCallId())) {
                        duplicates++;
                    }
                    if (!expected.contains(row.getExecutionCallId())) {
                        strangers++;
                    }
                }
                if (batch.isEmpty() || batch.size() < limit) {
                    break;
                }
                after = batch.get(batch.size() - 1).getExecutionCallId();
            }
            Set<String> missing = new HashSet<>(expected);
            missing.removeAll(seen);
            out.append(",\"limit").append(limit).append("\":{\"pages\":").append(pages.size())
                    .append(",\"firstPages\":\"").append(pages.subList(0, Math.min(4, pages.size())))
                    .append("\",\"found\":").append(seen.size())
                    .append(",\"missing\":").append(missing.size())
                    .append(",\"duplicates\":").append(duplicates)
                    .append(",\"strangers\":").append(strangers).append('}');
        }
        return out.append('}').toString();
    }

    private static RuntimeSessionRecord session(RuntimeScope scope, String harness, String sessionId,
            String binding, long generation) {
        return new RuntimeSessionRecord(new RuntimeSession(harness, sessionId, "bootstrap", scope),
                binding, generation, RuntimeSessionRecord.State.READY, 0, Instant.now());
    }

    private static ToolExecutionRecord record(RuntimeSessionRecord session, String id, boolean background) {
        Map<String, Object> reference = new LinkedHashMap<>();
        if (background) {
            reference.put("dispatchMode", "background_v3_process");
            reference.put("processOf", id + "-invocation");
        }
        reference.put("sessionId", session.getRuntimeSessionId());
        reference.put("promptId", "turn");
        reference.put("callId", id);
        reference.put("argsDigest", "digest");
        String executionId = background ? id + ":process" : id;
        return ToolExecutionRecord.prepared(executionId, executionId + "-key", session.getBindingId(),
                session.getRuntimeGeneration(), session.getSession().getHarnessSessionId(),
                session.getRuntimeSessionId(), "turn", id, "digest", Map.copyOf(reference));
    }
}
