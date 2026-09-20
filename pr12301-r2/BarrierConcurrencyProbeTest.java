package com.alibaba.qwen.code.runtimebroker;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.List;
import java.util.ArrayList;
import java.util.Set;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/** Deterministic replacement for the PR's 32-task/8-thread race probe. */
class BarrierConcurrencyProbeTest {
    private static final Instant START = Instant.parse("2026-09-18T00:00:00Z");
    private static final RuntimeScope SCOPE = new RuntimeScope("tenant",
            "workspace", "generation", "/workspace", "capability", "session");
    private static final RuntimeProvisionRequest REQUEST =
            new RuntimeProvisionRequest(SCOPE, "harness");

    @Test
    void findOrCreateIsAtomicUnderSimultaneousRelease() throws Exception {
        int threads = Math.max(8, Runtime.getRuntime().availableProcessors() * 2);
        for (int round = 0; round < 200; round++) {
            AtomicInteger ids = new AtomicInteger();
            InMemoryRuntimeBindingRepository repository =
                    new InMemoryRuntimeBindingRepository(new FixedClock(),
                            () -> "binding-" + ids.incrementAndGet());
            CyclicBarrier gate = new CyclicBarrier(threads);
            ExecutorService pool = Executors.newFixedThreadPool(threads);
            try {
                List<Future<RuntimeBindingRecord>> futures = new ArrayList<>();
                for (int i = 0; i < threads; i++) {
                    futures.add(pool.submit(() -> {
                        gate.await();
                        return repository.findOrCreate(REQUEST);
                    }));
                }
                Set<String> seen = new HashSet<>();
                for (Future<RuntimeBindingRecord> f : futures) {
                    seen.add(f.get().getBindingId());
                }
                assertEquals(1, seen.size(),
                        "round " + round + " produced bindings " + seen);
                assertEquals(1, ids.get(), "round " + round + " minted extra ids");
            } finally {
                pool.shutdownNow();
            }
        }
    }

    private static final class FixedClock extends Clock {
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return START; }
    }
}
