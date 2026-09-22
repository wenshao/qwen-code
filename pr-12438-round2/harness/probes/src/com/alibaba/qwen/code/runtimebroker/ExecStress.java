package com.alibaba.qwen.code.runtimebroker;

import static com.alibaba.qwen.code.runtimebroker.ProbeKit.*;

import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.LockSupport;

/**
 * Unhooked stress for the widened re-drive: per round a fresh idempotency
 * key, N threads call createExecution with it at once while C threads
 * cancel it; execute completes on another thread at a random microsecond.
 * Invariants: at most one physical execute per key, and after all calls
 * return plus one lease, a same-key retry leaves the record settled or
 * UNKNOWN. args: rounds creators cancellers leaseMillis
 */
public final class ExecStress {
    public static void main(String[] args) throws Exception {
        int rounds = Integer.parseInt(args[0]);
        int creators = Integer.parseInt(args[1]);
        int cancellers = Integer.parseInt(args[2]);
        long leaseMillis = Long.parseLong(args[3]);
        Clock clock = Clock.systemUTC();
        Map<String, AtomicInteger> executes = new ConcurrentHashMap<>();
        ExecutorService completer = Executors.newFixedThreadPool(4);
        Transport transport = new Transport();
        transport.execute = reference -> {
            executes.computeIfAbsent((String) reference.get("callId"),
                    k -> new AtomicInteger()).incrementAndGet();
            CompletableFuture<Map<String, Object>> result =
                    new CompletableFuture<>();
            completer.execute(() -> {
                LockSupport.parkNanos(ThreadLocalRandom.current()
                        .nextLong(0, 300_000));
                result.complete(Map.of("executionStatus", "success"));
            });
            return result;
        };
        transport.cancel = reference -> CompletableFuture.completedFuture(
                Map.of("state", "cancel_requested"));
        InMemoryToolExecutionRepository executions =
                new InMemoryToolExecutionRepository(clock);
        ExecutorService pool = Executors.newFixedThreadPool(
                creators + cancellers);
        Map<String, AtomicInteger> errors = new ConcurrentHashMap<>();
        int duplicates = 0;
        int stuck = 0;
        Map<String, AtomicInteger> finals = new ConcurrentHashMap<>();
        long started = System.nanoTime();
        try (RuntimeBrokerService service = service(scope("exec", "workspace"),
                new Provisioner(), transport,
                new InMemoryRuntimeBindingRepository(clock, () -> "b"),
                new InMemoryRuntimeSessionRepository(), executions, "broker",
                Duration.ofHours(1), Duration.ofMillis(leaseMillis), clock)) {
            join(service.acquire("h", "rs", "bootstrap"));
            for (int round = 0; round < rounds; round++) {
                String key = "k" + round;
                String call = "c" + round;
                CyclicBarrier barrier = new CyclicBarrier(creators
                        + cancellers);
                List<CompletableFuture<Void>> calls = new ArrayList<>();
                for (int i = 0; i < creators; i++) {
                    calls.add(CompletableFuture.runAsync(() -> {
                        await(barrier);
                        record(errors, () -> service.createExecution("h",
                                "rs", key, reference("rs", call)));
                    }, pool));
                }
                for (int i = 0; i < cancellers; i++) {
                    calls.add(CompletableFuture.runAsync(() -> {
                        await(barrier);
                        ToolExecutionRecord seen;
                        while ((seen = executions.findByIdempotencyKey(key))
                                == null) {
                            Thread.onSpinWait();
                        }
                        String id = seen.getExecutionCallId();
                        record(errors, () -> service.cancelExecution("h",
                                "rs", id));
                    }, pool));
                }
                CompletableFuture.allOf(calls.toArray(
                        CompletableFuture[]::new)).get(30, TimeUnit.SECONDS);
                LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(
                        Math.min(leaseMillis, 50) + 2));
                ToolExecutionRecord last = null;
                for (int attempt = 0; attempt < 200; attempt++) {
                    try {
                        last = join(service.createExecution("h", "rs", key,
                                reference("rs", call)));
                    } catch (RuntimeException ignored) {
                        last = executions.findByIdempotencyKey(key);
                    }
                    if (last.isSettled() || last.getState()
                            == ToolExecutionRecord.State.UNKNOWN) {
                        break;
                    }
                    LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(5));
                }
                finals.computeIfAbsent(last.getState()
                        + (last.getExecutionStatus() == null ? ""
                                : "/" + last.getExecutionStatus()),
                        k -> new AtomicInteger()).incrementAndGet();
                if (!(last.isSettled() || last.getState()
                        == ToolExecutionRecord.State.UNKNOWN)) {
                    stuck++;
                }
                AtomicInteger n = executes.get(call);
                if (n != null && n.get() > 1) {
                    duplicates++;
                }
            }
        } finally {
            pool.shutdownNow();
            completer.shutdownNow();
        }
        System.out.printf("%sexec%s rounds=%d creators=%d cancellers=%d "
                + "lease=%dms  duplicate executes=%s%d%s  stuck=%s%d%s  "
                + "(%.1fs)%n", C, N, rounds, creators, cancellers,
                leaseMillis, duplicates == 0 ? G : R, duplicates, N,
                stuck == 0 ? G : R, stuck, N,
                (System.nanoTime() - started) / 1e9);
        System.out.println("  final states: " + new java.util.TreeMap<>(
                finals));
        errors.forEach((k, v) -> System.out.println("  error x" + v.get()
                + ": " + k));
        System.exit(0);
    }

    private static void await(CyclicBarrier barrier) {
        try {
            barrier.await(10, TimeUnit.SECONDS);
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static void record(Map<String, AtomicInteger> errors,
            java.util.function.Supplier<java.util.concurrent.CompletionStage<
                    ToolExecutionRecord>> call) {
        String outcome = outcome(() -> call.get());
        if (!"ok".equals(outcome)) {
            errors.computeIfAbsent(outcome, k -> new AtomicInteger())
                    .incrementAndGet();
        }
    }
}
