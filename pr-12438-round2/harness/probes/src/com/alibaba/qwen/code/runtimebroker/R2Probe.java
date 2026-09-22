package com.alibaba.qwen.code.runtimebroker;

import static com.alibaba.qwen.code.runtimebroker.ProbeKit.*;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Round-2 probes for the paths 4ba99cf59a added: cancellation after a
 * lapse, renewal-level fencing, transient renewal failures and a settled
 * cancellation acknowledgement that arrives after a lapse. Every scenario
 * prints facts; nothing is asserted, so the same file runs on both heads.
 */
public final class R2Probe {
    private static final Instant START = Instant.parse("2026-09-22T00:00:00Z");
    private static final Duration MINUTE = Duration.ofMinutes(1);

    public static void main(String[] args) throws Exception {
        String only = args.length > 0 ? args[0] : null;
        if (only == null || only.contains("A")) cancelAfterLapse();
        if (only == null || only.contains("B")) transientRenewalFailure();
        if (only == null || only.contains("C")) renewalFencesByItself();
        if (only == null || only.contains("D")) settledAckAfterLapse();
        if (only == null || only.contains("E")) bindingRenewalTransient();
        System.exit(0);
    }

    private static String state(ToolExecutionRecord record) {
        return record == null ? "null" : record.getState()
                + (record.getExecutionStatus() == null ? ""
                        : "/" + record.getExecutionStatus())
                + (record.isCancelRequested() ? " cancelRequested" : "");
    }

    /** R2-A: cancel while execute is still running here, lease lapsed. */
    static void cancelAfterLapse() {
        header("R2-A cancel after the dispatch lease lapsed, execute still "
                + "running in this process");
        for (boolean lapse : List.of(false, true)) {
            MutableClock clock = new MutableClock(START);
            Transport transport = new Transport();
            CompletableFuture<Map<String, Object>> late =
                    new CompletableFuture<>();
            transport.execute = reference -> late;
            InMemoryToolExecutionRepository executions =
                    new InMemoryToolExecutionRepository(clock);
            RuntimeScope scope = scope("r2a-" + lapse, "workspace");
            try (RuntimeBrokerService service = service(scope,
                    new Provisioner(), transport,
                    new InMemoryRuntimeBindingRepository(clock,
                            () -> "binding-r2a"),
                    new InMemoryRuntimeSessionRepository(), executions,
                    "broker", Duration.ofHours(1), MINUTE, clock)) {
                join(service.acquire("h", "rs", "bootstrap"));
                ToolExecutionRecord created = join(service.createExecution(
                        "h", "rs", "k", reference("rs", "c")));
                if (lapse) {
                    // Renewal ticks every lease/3 of wall time (20 s), so
                    // nothing renews during the probe: the lapse is exact.
                    clock.advance(Duration.ofMinutes(2));
                }
                ToolExecutionRecord first = join(service.cancelExecution("h",
                        "rs", created.getExecutionCallId()));
                int afterFirst = transport.cancelCalls.get();
                ToolExecutionRecord second = join(service.cancelExecution(
                        "h", "rs", created.getExecutionCallId()));
                int afterSecond = transport.cancelCalls.get();
                late.complete(Map.of("executionStatus", "success"));
                ToolExecutionRecord afterResult = executions
                        .findByExecutionCallId(created.getExecutionCallId());
                ToolExecutionRecord retry = join(service.createExecution("h",
                        "rs", "k", reference("rs", "c")));
                String label = lapse ? "lease lapsed" : "lease live  ";
                row("R2-A " + (lapse ? "lapse" : "live "),
                        afterFirst == 1,
                        label + ": cancel#1 -> " + state(first)
                                + ", transport.cancel calls=" + afterFirst
                                + "; cancel#2 -> " + state(second)
                                + ", calls=" + afterSecond);
                note("        then execute completes -> " + state(afterResult)
                        + "; same-key retry -> " + state(retry)
                        + "; execute calls " + transport.executeCalls.get());
            }
        }
    }

    /** R2-B: one transient renewDispatch exception, real clock. */
    static void transientRenewalFailure() throws Exception {
        header("R2-B one transient renewDispatch exception while execute "
                + "runs longer than the lease (real clock, lease 300 ms)");
        Clock clock = Clock.systemUTC();
        Transport transport = new Transport();
        ScheduledExecutorService timer =
                Executors.newSingleThreadScheduledExecutor();
        transport.execute = reference -> {
            CompletableFuture<Map<String, Object>> result =
                    new CompletableFuture<>();
            timer.schedule(() -> result.complete(
                    Map.of("executionStatus", "success")), 1000,
                    TimeUnit.MILLISECONDS);
            return result;
        };
        HookedExecutions executions = new HookedExecutions(
                new InMemoryToolExecutionRepository(clock));
        executions.renewThrows.set(1);
        try (RuntimeBrokerService service = service(scope("r2b",
                "workspace"), new Provisioner(), transport,
                new InMemoryRuntimeBindingRepository(clock,
                        () -> "binding-r2b"),
                new InMemoryRuntimeSessionRepository(), executions,
                "broker", Duration.ofHours(1), Duration.ofMillis(300),
                clock)) {
            join(service.acquire("h", "rs", "bootstrap"));
            ToolExecutionRecord created = join(service.createExecution("h",
                    "rs", "k", reference("rs", "c")));
            sleep(1500);
            ToolExecutionRecord after = executions.findByExecutionCallId(
                    created.getExecutionCallId());
            row("R2-B", after.isSettled(), "after the result arrived: "
                    + state(after) + "; renewDispatch calls="
                    + executions.renewCalls.get() + " (first threw)");
        } finally {
            timer.shutdownNow();
        }
    }

    /** R2-C: the renewal itself fences a lapsed claim, no retry. */
    static void renewalFencesByItself() throws Exception {
        header("R2-C lapse detected by the renewal task itself, no caller "
                + "retry (lease 300 ms of wall cadence, clock jumps 2 min)");
        MutableClock clock = new MutableClock(START);
        Transport transport = new Transport();
        CompletableFuture<Map<String, Object>> late =
                new CompletableFuture<>();
        transport.execute = reference -> late;
        HookedExecutions executions = new HookedExecutions(
                new InMemoryToolExecutionRepository(clock));
        try (RuntimeBrokerService service = service(scope("r2c",
                "workspace"), new Provisioner(), transport,
                new InMemoryRuntimeBindingRepository(clock,
                        () -> "binding-r2c"),
                new InMemoryRuntimeSessionRepository(), executions,
                "broker", Duration.ofHours(1), Duration.ofMillis(300),
                clock)) {
            join(service.acquire("h", "rs", "bootstrap"));
            ToolExecutionRecord created = join(service.createExecution("h",
                    "rs", "k", reference("rs", "c")));
            clock.advance(Duration.ofMinutes(2));
            sleep(400);
            ToolExecutionRecord fenced = executions.findByExecutionCallId(
                    created.getExecutionCallId());
            late.complete(Map.of("executionStatus", "success"));
            ToolExecutionRecord after = executions.findByExecutionCallId(
                    created.getExecutionCallId());
            row("R2-C", fenced.getState() == ToolExecutionRecord.State.UNKNOWN,
                    "400 ms after the jump: " + state(fenced)
                            + "; late success -> " + state(after)
                            + "; claimDispatch calls from renewal="
                            + executions.claimCalls.get());
        }
    }

    /** R2-D: R1-2's third symptom, settled ack after a lapse. */
    static void settledAckAfterLapse() {
        header("R2-D Runtime confirms settled/cancelled after the dispatch "
                + "lease lapsed (R1-2 third symptom)");
        MutableClock clock = new MutableClock(START);
        Transport transport = new Transport();
        CompletableFuture<Map<String, Object>> late =
                new CompletableFuture<>();
        CompletableFuture<Map<String, Object>> ack =
                new CompletableFuture<>();
        transport.execute = reference -> late;
        transport.cancel = reference -> ack;
        InMemoryToolExecutionRepository executions =
                new InMemoryToolExecutionRepository(clock);
        try (RuntimeBrokerService service = service(scope("r2d",
                "workspace"), new Provisioner(), transport,
                new InMemoryRuntimeBindingRepository(clock,
                        () -> "binding-r2d"),
                new InMemoryRuntimeSessionRepository(), executions,
                "broker", Duration.ofHours(1), MINUTE, clock)) {
            join(service.acquire("h", "rs", "bootstrap"));
            ToolExecutionRecord created = join(service.createExecution("h",
                    "rs", "k", reference("rs", "c")));
            var cancel = service.cancelExecution("h", "rs",
                    created.getExecutionCallId());
            clock.advance(Duration.ofMinutes(2));
            ack.complete(Map.of("state", "settled", "result",
                    Map.of("executionStatus", "cancelled")));
            String outcome = outcome(() -> cancel);
            ToolExecutionRecord stored = executions.findByExecutionCallId(
                    created.getExecutionCallId());
            String again = outcome(() -> service.cancelExecution("h",
                    "rs", created.getExecutionCallId())) + " "
                    + state(executions.findByExecutionCallId(
                            created.getExecutionCallId()));
            late.complete(Map.of("executionStatus", "cancelled"));
            ToolExecutionRecord retry = join(service.createExecution("h",
                    "rs", "k", reference("rs", "c")));
            row("R2-D", "ok".equals(outcome), "cancel -> " + outcome
                    + "; stored " + state(stored));
            note("        cancel again -> " + again
                    + "; execute completes, same-key retry -> "
                    + state(retry));
        }
    }

    /** Delegating execution repository with renewal/claim hooks. */
    static final class HookedExecutions implements ToolExecutionRepository {
        final ToolExecutionRepository delegate;
        final AtomicInteger renewThrows = new AtomicInteger();
        final AtomicInteger renewCalls = new AtomicInteger();
        final AtomicInteger claimCalls = new AtomicInteger();

        HookedExecutions(ToolExecutionRepository delegate) {
            this.delegate = delegate;
        }

        @Override
        public ToolExecutionRecord findOrCreate(ToolExecutionRecord c) {
            return delegate.findOrCreate(c);
        }

        @Override
        public ToolExecutionRecord findByExecutionCallId(String id) {
            return delegate.findByExecutionCallId(id);
        }

        @Override
        public ToolExecutionRecord findByIdempotencyKey(String key) {
            return delegate.findByIdempotencyKey(key);
        }

        @Override
        public ToolExecutionRecord compareAndSet(ToolExecutionRecord e,
                ToolExecutionRecord r, String owner, long generation) {
            return delegate.compareAndSet(e, r, owner, generation);
        }

        @Override
        public ToolExecutionRecord claimDispatch(String id, String owner,
                Duration lease) {
            if (!"main".equals(Thread.currentThread().getName())) {
                claimCalls.incrementAndGet();
            }
            return delegate.claimDispatch(id, owner, lease);
        }

        @Override
        public ToolExecutionRecord renewDispatch(String id, String owner,
                long generation, Duration lease) {
            renewCalls.incrementAndGet();
            if (renewThrows.getAndUpdate(v -> Math.max(0, v - 1)) > 0) {
                throw new IllegalStateException(
                        "injected: transient connection reset");
            }
            return delegate.renewDispatch(id, owner, generation, lease);
        }

        @Override
        public ToolExecutionRecord requestCancel(String id, long version) {
            return delegate.requestCancel(id, version);
        }

        @Override
        public ToolExecutionRecord resolveUnknown(ToolExecutionRecord e,
                Map<String, Object> result, Instant time) {
            return delegate.resolveUnknown(e, result, time);
        }

        @Override
        public boolean hasActiveByRuntimeSession(String runtimeSessionId) {
            return delegate.hasActiveByRuntimeSession(runtimeSessionId);
        }
    }

    /** R2-E: one transient renewOperation exception during provisioning. */
    static void bindingRenewalTransient() throws Exception {
        header("R2-E one transient renewOperation exception while the "
                + "provisioner runs longer than the lease (real clock, "
                + "operation lease 300 ms, provisioning 1000 ms)");
        Clock clock = Clock.systemUTC();
        Provisioner provisioner = new Provisioner();
        ScheduledExecutorService timer =
                Executors.newSingleThreadScheduledExecutor();
        provisioner.behaviour = call -> {
            CompletableFuture<RuntimeLease> lease = new CompletableFuture<>();
            timer.schedule(() -> lease.complete(lease(call)), 1000,
                    TimeUnit.MILLISECONDS);
            return lease;
        };
        AtomicInteger throwsLeft = new AtomicInteger(1);
        PausingBindingRepository bindings = new PausingBindingRepository(
                new InMemoryRuntimeBindingRepository(clock,
                        () -> "binding-r2e")) {
            @Override
            public RuntimeBindingRecord renewOperation(String bindingId,
                    String owner, long operationGeneration,
                    Duration leaseDuration) {
                if (throwsLeft.getAndUpdate(v -> Math.max(0, v - 1)) > 0) {
                    throw new IllegalStateException(
                            "injected: transient connection reset");
                }
                return super.renewOperation(bindingId, owner,
                        operationGeneration, leaseDuration);
            }
        };
        try (RuntimeBrokerService service = service(scope("r2e",
                "workspace"), provisioner, new Transport(), bindings,
                new InMemoryRuntimeSessionRepository(),
                new InMemoryToolExecutionRepository(clock), "broker",
                Duration.ofMillis(300), MINUTE, clock)) {
            String first = outcome(() -> service.warm("h"));
            sleep(400);
            String second = outcome(() -> service.warm("h"));
            row("R2-E", "ok".equals(first), "warm -> " + first
                    + "; after the lease: warm -> " + second
                    + "; provisioner calls=" + provisioner.calls.get());
        } finally {
            timer.shutdownNow();
        }
    }
}
