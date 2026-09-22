package com.alibaba.qwen.code.runtimebroker;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * One broker JVM. Phase A: every thread creates every key at once. Phase B: dispatch churn with random stalls
 * longer than the lease (a paused or GC-stalled dispatcher), cancels and UNKNOWN resolutions from every node.
 * "EXEC" is logged at the only point where a real dispatcher would send the Tool call to the Runtime.
 */
public class RaceNode {
    public static void main(String[] a) throws Exception {
        String url = a[0], run = a[1], node = a[2];
        long startAt = Long.parseLong(a[3]);
        int threads = Integer.parseInt(a[4]), keys = Integer.parseInt(a[5]);
        long churnMs = Long.parseLong(a[6]) * 1000;
        PrintWriter log = new PrintWriter(new FileWriter(a[7]), true);
        DriverManagerDataSource ds = new DriverManagerDataSource(url, "root", "");
        JdbcToolExecutionRepository repo = new JdbcToolExecutionRepository(ds);
        AtomicInteger errors = new AtomicInteger();
        Thread[] ts = new Thread[threads];
        for (int t = 0; t < threads; t++) {
            final String owner = node + "-t" + t;
            ts[t] = new Thread(() -> {
                try {
                    sleepUntil(startAt);
                    for (int k = 0; k < keys; k++) {
                        String p = run + "-k" + k;
                        ToolExecutionRecord candidate = ToolExecutionRecord.prepared(owner + "-" + UUID.randomUUID(),
                                p + "-key", p + "-binding", 1, p + "-harness", p + "-rs", p + "-turn", p + "-call",
                                p + "-digest", Map.of("sessionId", p + "-rs", "promptId", p + "-turn", "callId",
                                        p + "-call", "argsDigest", p + "-digest", "attempt", 1L));
                        try {
                            ToolExecutionRecord got = repo.findOrCreate(candidate);
                            log.println("A " + k + " " + got.getExecutionCallId() + " " + got.sameRequest(candidate));
                        } catch (RuntimeException e) {
                            errors.incrementAndGet();
                            log.println("ERR A " + e);
                        }
                    }
                    sleepUntil(startAt + 8000);
                    long end = startAt + 8000 + churnMs;
                    ThreadLocalRandom r = ThreadLocalRandom.current();
                    while (System.currentTimeMillis() < end) {
                        // Sliding hot window: every node hammers the same ~12 executions at once.
                        int k = keys + (int) ((System.currentTimeMillis() - startAt - 8000) / 250) * 6 + r.nextInt(12);
                        try {
                            String p = run + "-k" + k;
                            ToolExecutionRecord candidate = ToolExecutionRecord.prepared(owner + "-" + UUID.randomUUID(),
                                    p + "-key", p + "-binding", 1, p + "-harness", p + "-rs", p + "-turn", p + "-call",
                                    p + "-digest", Map.of("sessionId", p + "-rs", "promptId", p + "-turn", "callId",
                                            p + "-call", "argsDigest", p + "-digest", "attempt", 1L));
                            ToolExecutionRecord rec = repo.findOrCreate(candidate);
                            if (!rec.sameRequest(candidate)) log.println("ERR B sameRequest=false " + k);
                            String id = rec.getExecutionCallId();
                            int dice = r.nextInt(100);
                            if (dice < 70) {
                                ToolExecutionRecord c = repo.claimDispatch(id, owner, Duration.ofMillis(30 + r.nextInt(250)));
                                if (c == null || !owner.equals(c.getDispatchOwner())
                                        || c.getState() != ToolExecutionRecord.State.DISPATCHING) {
                                    continue;
                                }
                                long gen = c.getDispatchGeneration();
                                log.println("CLAIM " + id + " " + gen + " " + owner);
                                Thread.sleep(r.nextInt(3) == 0 ? r.nextInt(400) : r.nextInt(20));
                                ToolExecutionRecord next = c.isCancelRequested()
                                        ? c.withResult(Map.of("executionStatus", "cancelled", "by", owner), c.getLastSequence(), Instant.now())
                                        : c.withState(ToolExecutionRecord.State.EXECUTING, false);
                                ToolExecutionRecord ex = repo.compareAndSet(c, next, owner, gen);
                                if (ex == null) { log.println("FENCED " + id + " " + gen + " " + owner); continue; }
                                if (ex.isSettled()) { log.println("SETTLE " + id + " " + gen + " " + owner + " cancelled"); continue; }
                                log.println("EXEC " + id + " " + gen + " " + owner);
                                Thread.sleep(r.nextInt(3) == 0 ? r.nextInt(400) : r.nextInt(20));
                                if (r.nextBoolean()) {
                                    ToolExecutionRecord renewed = repo.renewDispatch(id, owner, gen, Duration.ofMillis(200));
                                    if (renewed != null) ex = renewed;
                                }
                                Map<String, Object> result = new LinkedHashMap<>();
                                result.put("executionStatus", "success");
                                result.put("owner", owner);
                                result.put("gen", gen);
                                ToolExecutionRecord current = ex;
                                for (int i = 0; i < 3 && current != null; i++) {
                                    ToolExecutionRecord done = repo.compareAndSet(current,
                                            current.withResult(result, current.getLastSequence() + 1, Instant.now()), owner, gen);
                                    if (done != null) { log.println("SETTLE " + id + " " + gen + " " + owner + " success"); break; }
                                    current = repo.findByExecutionCallId(id);
                                }
                            } else if (dice < 85) {
                                ToolExecutionRecord x = repo.requestCancel(id, rec.getVersion());
                                if (x != null && x.isSettled()) log.println("SETTLE " + id + " 0 " + owner + " cancel-prepared");
                            } else if (rec.getState() == ToolExecutionRecord.State.UNKNOWN) {
                                ToolExecutionRecord x = repo.resolveUnknown(rec, Map.of("executionStatus", "error", "resolvedBy", owner), Instant.now());
                                if (x != null) log.println("RESOLVE " + id + " " + owner);
                            } else {
                                repo.hasActiveByRuntimeSession(rec.getRuntimeSessionId());
                            }
                        } catch (InterruptedException e) {
                            return;
                        } catch (RuntimeException e) {
                            errors.incrementAndGet();
                            log.println("ERR B " + e + (e.getCause() == null ? "" : " / " + e.getCause()));
                        }
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
            ts[t].start();
        }
        for (Thread t : ts) t.join();
        log.println("DONE errors=" + errors.get());
        log.close();
    }

    static void sleepUntil(long at) throws InterruptedException {
        long d = at - System.currentTimeMillis();
        if (d > 0) Thread.sleep(d);
    }
}
