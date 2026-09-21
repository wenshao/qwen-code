package com.alibaba.qwen.code.runtimebroker;

import java.time.Duration;
import java.time.Instant;

/** init <url> <startMs> | nanos <url> <label> */
public final class MiscProbe {
    public static void main(String[] args) throws Exception {
        SimpleDs ds = SimpleDs.of(args[1]);
        if ("init".equals(args[0])) {
            ds.getConnection().close();
            long wait = Long.parseLong(args[2]) - System.currentTimeMillis();
            if (wait > 0) {
                Thread.sleep(wait);
            }
            try {
                JdbcRuntimeBrokerSchema.initialize(ds);
                System.out.println("initialize OK");
            } catch (RuntimeException failure) {
                System.out.println("initialize FAILED: "
                        + RaceWorker.rootMessage(failure));
            }
            return;
        }
        JdbcRuntimeBrokerSchema.initialize(ds);
        JdbcRuntimeBindingRepository repo =
                new JdbcRuntimeBindingRepository(ds);
        for (String text : new String[] {"2026-09-20T00:00:00.123456789Z",
            "2026-09-20T00:00:00.999999500Z"}) {
            Instant at = Instant.parse(text);
            RuntimeBindingRecord created = repo.findOrCreate(
                    RaceWorker.request("n" + System.nanoTime(), "x"));
            RuntimeBindingRecord claimed = repo.claimOperation(
                    created.getBindingId(), "o", Duration.ofMinutes(5));
            RuntimeBindingRecord returned = repo.compareAndSet(claimed,
                    claimed.withDrainRequested(true, at));
            RuntimeBindingRecord stored = repo.findById(
                    created.getBindingId());
            System.out.printf("[%s] caller lastActiveAt=%s  CAS returned=%s  "
                    + "stored=%s%n", args[2], at,
                    returned.getLastActiveAt(), stored.getLastActiveAt());
        }
    }
}
