package com.alibaba.qwen.code.runtimebroker;

import java.net.URI;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicLong;

/**
 * One broker process in a multi-JVM race.
 *
 * race  &lt;url&gt; &lt;runId&gt; &lt;worker&gt; &lt;threads&gt; &lt;startEpochMs&gt; &lt;scopes&gt; &lt;churnSec&gt;
 * check &lt;url&gt; &lt;runId&gt;
 * hold  &lt;url&gt; &lt;runId&gt; &lt;sleepMs&gt;    findOrCreate whose idSupplier sleeps inside the slot lock
 * once  &lt;url&gt; &lt;runId&gt;              one timed findOrCreate on the "hold" scope
 */
public final class RaceWorker {
    private RaceWorker() {
    }

    public static void main(String[] args) throws Exception {
        String mode = args[0];
        SimpleDs ds = SimpleDs.of(args[1]);
        String runId = args[2];
        if ("race".equals(mode)) {
            race(ds, runId, args[3], Integer.parseInt(args[4]),
                    Long.parseLong(args[5]), Integer.parseInt(args[6]),
                    Integer.parseInt(args[7]));
        } else if ("check".equals(mode)) {
            check(ds, runId);
        } else if ("hold".equals(mode)) {
            long sleepMs = Long.parseLong(args[3]);
            JdbcRuntimeBindingRepository repo =
                    new JdbcRuntimeBindingRepository(ds, () -> {
                        System.out.println("HOLDING slot lock pid="
                                + ProcessHandle.current().pid());
                        System.out.flush();
                        try {
                            Thread.sleep(sleepMs);
                        } catch (InterruptedException interrupted) {
                            throw new IllegalStateException(interrupted);
                        }
                        return runId + "-held-binding";
                    });
            RuntimeBindingRecord record = repo.findOrCreate(request(runId,
                    "hold"));
            System.out.println("holder finished: " + record.getBindingId());
        } else if ("once".equals(mode)) {
            JdbcRuntimeBindingRepository repo =
                    new JdbcRuntimeBindingRepository(ds,
                            () -> runId + "-survivor-binding");
            long started = System.nanoTime();
            try {
                RuntimeBindingRecord record = repo.findOrCreate(request(
                        runId, "hold"));
                System.out.println("survivor findOrCreate -> "
                        + record.getBindingId() + " generation="
                        + record.getGeneration() + " after "
                        + (System.nanoTime() - started) / 1_000_000 + " ms");
            } catch (RuntimeException failure) {
                System.out.println("survivor findOrCreate FAILED after "
                        + (System.nanoTime() - started) / 1_000_000 + " ms: "
                        + rootMessage(failure));
            }
        }
    }

    static RuntimeProvisionRequest request(String runId, String scope) {
        return new RuntimeProvisionRequest(new RuntimeScope(
                runId + "-tenant-" + scope, "workspace", "generation",
                "/workspace", "capability", "session"), "iso");
    }

    private static void race(SimpleDs ds, String runId, String worker,
            int threads, long startAt, int scopes, int churnSeconds)
            throws Exception {
        AtomicLong ids = new AtomicLong();
        Map<String, AtomicLong> counters = new ConcurrentHashMap<>();
        List<String> lines = java.util.Collections.synchronizedList(
                new ArrayList<>());
        CountDownLatch done = new CountDownLatch(threads);
        for (int t = 0; t < threads; t++) {
            String owner = worker + "-t" + t;
            Thread thread = new Thread(() -> {
                try {
                    JdbcRuntimeBindingRepository repo =
                            new JdbcRuntimeBindingRepository(ds,
                                    () -> runId + "-" + owner + "-"
                                            + ids.incrementAndGet());
                    // warm the connection + classes before the barrier
                    repo.findActive(request(runId, "warmup"));
                    long wait = startAt - System.currentTimeMillis();
                    if (wait > 0) {
                        Thread.sleep(wait);
                    }
                    // Phase A: everyone creates every scope at once.
                    for (int s = 0; s < scopes; s++) {
                        try {
                            RuntimeBindingRecord record = repo.findOrCreate(
                                    request(runId, "s" + s));
                            lines.add("CREATE s" + s + " "
                                    + record.getBindingId() + " "
                                    + record.getGeneration());
                        } catch (RuntimeException failure) {
                            bump(counters, "A-ERR " + rootMessage(failure));
                        }
                    }
                    // Phase B: everyone claims the same binding.
                    try {
                        RuntimeBindingRecord target = repo.findOrCreate(
                                request(runId, "s0"));
                        RuntimeBindingRecord claimed = repo.claimOperation(
                                target.getBindingId(), owner,
                                Duration.ofSeconds(120));
                        lines.add("CLAIM " + (claimed == null ? "null"
                                : claimed.getOperationOwner() + " "
                                        + claimed.getOperationGeneration()));
                    } catch (RuntimeException failure) {
                        bump(counters, "B-ERR " + rootMessage(failure));
                    }
                    // Phase C: churn create -> claim -> READY -> RELEASED.
                    long until = System.currentTimeMillis()
                            + churnSeconds * 1000L;
                    java.util.Random random = new java.util.Random(
                            owner.hashCode());
                    while (System.currentTimeMillis() < until) {
                        RuntimeProvisionRequest request = request(runId,
                                "c" + random.nextInt(3));
                        try {
                            RuntimeBindingRecord record = repo.findOrCreate(
                                    request);
                            bump(counters, "C-findOrCreate");
                            RuntimeBindingRecord claimed =
                                    repo.claimOperation(
                                            record.getBindingId(), owner,
                                            Duration.ofSeconds(30));
                            if (claimed == null) {
                                bump(counters, "C-claim-fenced");
                                continue;
                            }
                            bump(counters, "C-claim-granted");
                            RuntimeLease lease = new RuntimeLease(owner,
                                    URI.create("http://127.0.0.1:4096"),
                                    "token", "lease", 1);
                            RuntimeBindingRecord ready = repo.compareAndSet(
                                    claimed, claimed.withState(
                                            RuntimeBindingRecord.State.READY,
                                            lease, Instant.now()));
                            if (ready == null) {
                                bump(counters, "C-cas-ready-null");
                                continue;
                            }
                            RuntimeBindingRecord released =
                                    repo.compareAndSet(ready,
                                            ready.withState(
                                                    RuntimeBindingRecord
                                                            .State.RELEASED,
                                                    lease, Instant.now()));
                            bump(counters, released == null
                                    ? "C-cas-release-null"
                                    : "C-released");
                        } catch (RuntimeException failure) {
                            bump(counters, "C-ERR " + rootMessage(failure));
                        }
                    }
                } catch (Exception failure) {
                    bump(counters, "FATAL " + rootMessage(failure));
                } finally {
                    done.countDown();
                }
            }, owner);
            thread.start();
        }
        done.await();
        synchronized (lines) {
            for (String line : lines) {
                System.out.println(line);
            }
        }
        for (Map.Entry<String, AtomicLong> entry
                : new TreeMap<>(counters).entrySet()) {
            System.out.println("COUNT " + entry.getValue() + " "
                    + entry.getKey());
        }
    }

    private static void check(SimpleDs ds, String runId) throws Exception {
        try (Connection connection = ds.getConnection();
                Statement statement = connection.createStatement()) {
            String like = "'" + runId + "-tenant-%'";
            long[] row = new long[6];
            try (ResultSet rs = statement.executeQuery(
                    "SELECT COUNT(*), SUM(last_generation), "
                            + "SUM(active_binding_id IS NOT NULL) "
                            + "FROM qwen_runtime_binding_slot "
                            + "WHERE tenant_id LIKE " + like)) {
                rs.next();
                row[0] = rs.getLong(1);
                row[1] = rs.getLong(2);
                row[2] = rs.getLong(3);
            }
            try (ResultSet rs = statement.executeQuery(
                    "SELECT COUNT(*), SUM(binding_state NOT IN "
                            + "('FAILED','RELEASED')) "
                            + "FROM qwen_runtime_binding "
                            + "WHERE tenant_id LIKE " + like)) {
                rs.next();
                row[3] = rs.getLong(1);
                row[4] = rs.getLong(2);
            }
            System.out.println("slots=" + row[0] + " sum(last_generation)="
                    + row[1] + " bindings=" + row[3]
                    + "  (must be equal: every generation is one row)");
            System.out.println("slots with active binding=" + row[2]
                    + " active bindings=" + row[4] + "  (must be equal)");
            long violations = 0;
            // more than one active binding per request_key
            violations += count(statement, "SELECT COUNT(*) FROM (SELECT "
                    + "request_key FROM qwen_runtime_binding WHERE tenant_id "
                    + "LIKE " + like + " AND binding_state NOT IN "
                    + "('FAILED','RELEASED') GROUP BY request_key "
                    + "HAVING COUNT(*) > 1) x", "scopes with >1 active");
            // generation gaps: max(gen) != count(*) or != slot.last_generation
            violations += count(statement, "SELECT COUNT(*) FROM (SELECT "
                    + "b.request_key FROM qwen_runtime_binding b JOIN "
                    + "qwen_runtime_binding_slot s ON s.request_key = "
                    + "b.request_key WHERE b.tenant_id LIKE " + like
                    + " GROUP BY b.request_key, s.last_generation HAVING "
                    + "MAX(b.runtime_generation) <> COUNT(*) OR "
                    + "MAX(b.runtime_generation) <> s.last_generation) x",
                    "scopes with generation gap/dup");
            // slot pointer disagrees with the active row
            violations += count(statement, "SELECT COUNT(*) FROM "
                    + "qwen_runtime_binding_slot s LEFT JOIN "
                    + "qwen_runtime_binding b ON b.binding_id = "
                    + "s.active_binding_id WHERE s.tenant_id LIKE " + like
                    + " AND s.active_binding_id IS NOT NULL AND (b.binding_id"
                    + " IS NULL OR b.binding_state IN ('FAILED','RELEASED')"
                    + " OR b.request_key <> s.request_key)",
                    "slots pointing at a missing/terminal binding");
            violations += count(statement, "SELECT COUNT(*) FROM "
                    + "qwen_runtime_binding b JOIN qwen_runtime_binding_slot"
                    + " s ON s.request_key = b.request_key WHERE b.tenant_id "
                    + "LIKE " + like + " AND b.binding_state NOT IN "
                    + "('FAILED','RELEASED') AND (s.active_binding_id IS NULL"
                    + " OR s.active_binding_id <> b.binding_id)",
                    "active bindings not referenced by their slot");
            System.out.println(violations == 0 && row[1] == row[3]
                    && row[2] == row[4]
                    ? "INVARIANTS: PASS" : "INVARIANTS: FAIL");
        }
    }

    private static long count(Statement statement, String sql, String label)
            throws Exception {
        try (ResultSet rs = statement.executeQuery(sql)) {
            rs.next();
            long value = rs.getLong(1);
            System.out.println(String.format("%-48s = %d", label, value));
            return value;
        }
    }

    private static void bump(Map<String, AtomicLong> counters, String key) {
        counters.computeIfAbsent(key, ignored -> new AtomicLong())
                .incrementAndGet();
    }

    static String rootMessage(Throwable failure) {
        Throwable current = failure;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        String message = String.valueOf(current.getMessage());
        return current.getClass().getSimpleName() + ": "
                + message.substring(0, Math.min(100, message.length()));
    }
}
