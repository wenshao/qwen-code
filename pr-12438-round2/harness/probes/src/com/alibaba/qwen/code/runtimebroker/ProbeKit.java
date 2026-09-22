package com.alibaba.qwen.code.runtimebroker;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;

/** Shared fakes for the external probes (module package, harness only). */
final class ProbeKit {
    static final String G = "\033[1;32m";
    static final String R = "\033[1;31m";
    static final String Y = "\033[1;33m";
    static final String C = "\033[1;36m";
    static final String D = "\033[2m";
    static final String N = "\033[0m";

    static int failures;

    private ProbeKit() {
    }

    static void header(String text) {
        System.out.println(C + "== " + text + N);
    }

    static void row(String id, boolean ok, String detail) {
        if (!ok) {
            failures++;
        }
        System.out.printf("  %s%-5s%s %-10s %s%n", ok ? G : R,
                ok ? "ok" : "BUG", N, id, detail);
    }

    static void note(String text) {
        System.out.println("  " + D + text + N);
    }

    static RuntimeScope scope(String workspace, String isolation) {
        return new RuntimeScope("tenant", workspace, "g1", "/w/" + workspace,
                "cap", isolation);
    }

    static RuntimeLease lease(int index) {
        return new RuntimeLease("runtime-" + index,
                URI.create("http://127.0.0.1:" + (4000 + index)),
                "token-" + index, "lease-" + index, index);
    }

    static Map<String, Object> reference(String runtimeSessionId,
            String call) {
        return Map.of("sessionId", runtimeSessionId, "promptId", "prompt",
                "callId", call, "argsDigest", "digest-" + call);
    }

    static <T> T join(CompletionStage<T> stage) {
        return stage.toCompletableFuture().orTimeout(10, TimeUnit.SECONDS)
                .join();
    }

    /** Returns "ok" or a short description of how the call failed. */
    static String outcome(java.util.function.Supplier<CompletionStage<?>> call) {
        CompletionStage<?> stage;
        try {
            stage = call.get();
        } catch (RuntimeException exception) {
            return "sync " + describe(exception);
        }
        try {
            stage.toCompletableFuture().orTimeout(10, TimeUnit.SECONDS)
                    .join();
            return "ok";
        } catch (CompletionException exception) {
            return "async " + describe(unwrap(exception));
        } catch (java.util.concurrent.CancellationException exception) {
            return "async CancellationException";
        }
    }

    static Throwable unwrap(Throwable error) {
        Throwable current = error;
        while (current instanceof CompletionException
                && current.getCause() != null) {
            current = current.getCause();
        }
        return current;
    }

    static String describe(Throwable error) {
        if (error instanceof RuntimeBrokerException broker) {
            return "RuntimeBrokerException(" + broker.getStatusCode() + " "
                    + broker.getCode() + ", retryable="
                    + broker.isRetryable() + ")";
        }
        return error.getClass().getSimpleName() + "(" + error.getMessage()
                + ")";
    }

    static void await(java.util.function.BooleanSupplier condition,
            String what) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() > deadline) {
                throw new AssertionError("timed out waiting for " + what);
            }
            sleep(2);
        }
    }

    static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exception);
        }
    }

    static final class MutableClock extends Clock {
        private final AtomicReference<Instant> now;

        MutableClock(Instant start) {
            now = new AtomicReference<>(start);
        }

        void advance(Duration duration) {
            now.updateAndGet(value -> value.plus(duration));
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now.get();
        }
    }

    static final class Provisioner implements RuntimeProvisioner {
        final AtomicInteger calls = new AtomicInteger();
        final List<RuntimeProvisionRequest> requests =
                new CopyOnWriteArrayList<>();
        volatile Function<Integer, CompletionStage<RuntimeLease>> behaviour =
                call -> CompletableFuture.completedFuture(lease(call));

        @Override
        public CompletionStage<RuntimeLease> provision(
                RuntimeProvisionRequest request) {
            requests.add(request);
            return behaviour.apply(calls.incrementAndGet());
        }
    }

    /** Records every call together with the lease that carried it. */
    static final class Transport implements RuntimeTransport {
        final List<String> log = new CopyOnWriteArrayList<>();
        final AtomicInteger acquireCalls = new AtomicInteger();
        final AtomicInteger executeCalls = new AtomicInteger();
        final AtomicInteger cancelCalls = new AtomicInteger();
        final AtomicInteger releaseCalls = new AtomicInteger();
        volatile Function<RuntimeSession, CompletionStage<Void>> acquire =
                session -> CompletableFuture.completedFuture(null);
        volatile Function<Map<String, Object>,
                CompletionStage<Map<String, Object>>> execute =
                        reference -> CompletableFuture.completedFuture(
                                Map.of("executionStatus", "success"));
        volatile Function<Map<String, Object>,
                CompletionStage<Map<String, Object>>> cancel =
                        reference -> CompletableFuture.completedFuture(
                                Map.of("state", "cancel_requested"));
        volatile CompletionStage<Boolean> release =
                CompletableFuture.completedFuture(true);
        volatile Runnable onCancel = () -> { };

        @Override
        public CompletionStage<Void> acquire(RuntimeLease lease,
                RuntimeSession session) {
            acquireCalls.incrementAndGet();
            log.add("acquire " + session.getRuntimeSessionId() + " via "
                    + lease.getLeaseId());
            return acquire.apply(session);
        }

        @Override
        public CompletionStage<Object> control(RuntimeLease lease,
                RuntimeSession session, Map<String, Object> operation) {
            log.add("control " + session.getRuntimeSessionId() + " via "
                    + lease.getLeaseId());
            return CompletableFuture.completedFuture("ok");
        }

        @Override
        public CompletionStage<Map<String, Object>> execute(
                RuntimeLease lease, RuntimeSession session,
                Map<String, Object> reference) {
            executeCalls.incrementAndGet();
            log.add("execute " + reference.get("callId") + " via "
                    + lease.getLeaseId());
            return execute.apply(reference);
        }

        @Override
        public CompletionStage<Map<String, Object>> cancel(
                RuntimeLease lease, RuntimeSession session,
                Map<String, Object> reference) {
            cancelCalls.incrementAndGet();
            onCancel.run();
            log.add("cancel " + reference.get("callId"));
            return cancel.apply(reference);
        }

        @Override
        public CompletionStage<Boolean> release(RuntimeLease lease,
                RuntimeSession session) {
            releaseCalls.incrementAndGet();
            log.add("release " + session.getRuntimeSessionId());
            return release;
        }
    }

    /** Delegating binding repository with an optional pause hook. */
    static class PausingBindingRepository
            implements RuntimeBindingRepository {
        final RuntimeBindingRepository delegate;
        volatile java.util.function.Consumer<RuntimeBindingRecord>
                afterFindOrCreate = record -> { };

        PausingBindingRepository(RuntimeBindingRepository delegate) {
            this.delegate = delegate;
        }

        @Override
        public RuntimeBindingRecord findOrCreate(
                RuntimeProvisionRequest request) {
            RuntimeBindingRecord record = delegate.findOrCreate(request);
            afterFindOrCreate.accept(record);
            return record;
        }

        @Override
        public RuntimeBindingRecord findActive(
                RuntimeProvisionRequest request) {
            return delegate.findActive(request);
        }

        @Override
        public List<RuntimeBindingRecord> findActiveByIsolationKey(
                RuntimeScope scope, String isolationKey) {
            return delegate.findActiveByIsolationKey(scope, isolationKey);
        }

        @Override
        public RuntimeBindingRecord findById(String bindingId) {
            return delegate.findById(bindingId);
        }

        @Override
        public RuntimeBindingRecord compareAndSet(
                RuntimeBindingRecord expected,
                RuntimeBindingRecord replacement) {
            return delegate.compareAndSet(expected, replacement);
        }

        @Override
        public RuntimeBindingRecord claimOperation(String bindingId,
                String owner, Duration leaseDuration) {
            return delegate.claimOperation(bindingId, owner, leaseDuration);
        }

        @Override
        public RuntimeBindingRecord renewOperation(String bindingId,
                String owner, long operationGeneration,
                Duration leaseDuration) {
            return delegate.renewOperation(bindingId, owner,
                    operationGeneration, leaseDuration);
        }
    }

    /** Delegating execution repository that can fail chosen CAS calls. */
    static final class FaultyExecutionRepository
            implements ToolExecutionRepository {
        final ToolExecutionRepository delegate;
        final AtomicInteger casCalls = new AtomicInteger();
        volatile int failCasCall = -1;
        volatile int commitThenFailCasCall = -1;
        volatile Runnable afterClaim;

        FaultyExecutionRepository(ToolExecutionRepository delegate) {
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
            int call = casCalls.incrementAndGet();
            if (call == failCasCall) {
                throw new IllegalStateException(
                        "injected: repository connection reset");
            }
            ToolExecutionRecord updated = delegate.compareAndSet(e, r, owner,
                    generation);
            if (call == commitThenFailCasCall) {
                throw new IllegalStateException(
                        "injected: committed, then connection reset");
            }
            return updated;
        }

        @Override
        public ToolExecutionRecord claimDispatch(String id, String owner,
                Duration lease) {
            ToolExecutionRecord claimed = delegate.claimDispatch(id, owner,
                    lease);
            Runnable hook = afterClaim;
            if (hook != null) {
                afterClaim = null;
                hook.run();
            }
            return claimed;
        }

        @Override
        public ToolExecutionRecord renewDispatch(String id, String owner,
                long generation, Duration lease) {
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

    static RuntimeBrokerService service(RuntimeScope scope,
            Provisioner provisioner, Transport transport,
            RuntimeBindingRepository bindings,
            RuntimeSessionRepository sessions,
            ToolExecutionRepository executions, String owner,
            Duration operationLease, Duration dispatchLease, Clock clock) {
        AtomicInteger ids = new AtomicInteger();
        return new RuntimeBrokerService(
                ignored -> CompletableFuture.completedFuture(scope),
                provisioner, transport, bindings, sessions, executions,
                owner, operationLease, dispatchLease, clock,
                () -> owner + "-exec-" + ids.incrementAndGet());
    }
}
