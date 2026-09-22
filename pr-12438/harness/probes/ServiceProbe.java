package com.alibaba.qwen.code.runtimebroker;

import static com.alibaba.qwen.code.runtimebroker.ProbeKit.*;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Black-box probes of RuntimeBrokerService (run against any arm). */
public final class ServiceProbe {
    private static final Instant START = Instant.parse("2026-09-22T00:00:00Z");
    private static final Duration MINUTE = Duration.ofMinutes(1);

    public static void main(String[] args) throws Exception {
        Set<String> only = args.length == 0 ? null : Set.of(args);
        if (only == null || only.contains("S1")) s1DoubleProvision();
        if (only == null || only.contains("S2")) s2StuckDispatching();
        if (only == null || only.contains("S2")) s2bNoProgressPaths();
        if (only == null || only.contains("S3")) s3ErrorSurface();
        if (only == null || only.contains("S4")) s4Cancellation();
        if (only == null || only.contains("S5")) s5Concurrency();
        if (only == null || only.contains("S6")) s6UnknownPinsSession();
        if (only == null || only.contains("S7")) s7CrossHarness();
        if (only == null || only.contains("S8")) s8ProvisionFailure();
        if (only == null || only.contains("S9")) s9ReleaseRetry();
        if (only == null || only.contains("S10")) s10BlockingTransport();
        if (only == null || only.contains("S11")) s11WarmReturnsToken();
        if (only == null || only.contains("S12")) s12StaleDispatchOwner();
        System.out.println(failures == 0 ? G + "ALL PROBES OK" + N
                : R + failures + " PROBE ROW(S) FLAGGED" + N);
    }

    /** A caller that read PROVISIONING just before READY re-provisions. */
    static void s1DoubleProvision() throws Exception {
        header("S1  concurrent acquire across the PROVISIONING -> READY edge");
        RuntimeScope scope = scope("s1", "workspace");
        Provisioner provisioner = new Provisioner();
        Transport transport = new Transport();
        CompletableFuture<RuntimeLease> first = new CompletableFuture<>();
        provisioner.behaviour = call -> call == 1 ? first
                : CompletableFuture.completedFuture(lease(call));
        PausingBindingRepository bindings = new PausingBindingRepository(
                new InMemoryRuntimeBindingRepository());
        CountDownLatch t2Read = new CountDownLatch(1);
        CountDownLatch t2Go = new CountDownLatch(1);
        bindings.afterFindOrCreate = record -> {
            if ("T2".equals(Thread.currentThread().getName())
                    && record.getState()
                            == RuntimeBindingRecord.State.PROVISIONING) {
                t2Read.countDown();
                try {
                    t2Go.await();
                } catch (InterruptedException exception) {
                    throw new IllegalStateException(exception);
                }
            }
        };
        try (RuntimeBrokerService service = service(scope, provisioner,
                transport, bindings, new InMemoryRuntimeSessionRepository(),
                new InMemoryToolExecutionRepository(), "broker", MINUTE,
                MINUTE, Clock.systemUTC())) {
            CompletionStage<RuntimeSessionRecord> rs1 = service.acquire(
                    "harness-1", "rs-1", "bootstrap");
            AtomicReference<CompletionStage<RuntimeSessionRecord>> rs2 =
                    new AtomicReference<>();
            Thread t2 = new Thread(() -> rs2.set(service.acquire(
                    "harness-2", "rs-2", "bootstrap")), "T2");
            t2.start();
            t2Read.await(5, TimeUnit.SECONDS);
            note("T2 has read the binding while it is PROVISIONING; "
                    + "provisioning #1 now completes");
            first.complete(lease(1));
            RuntimeSessionRecord a = join(rs1);
            t2Go.countDown();
            t2.join();
            RuntimeSessionRecord b = join(rs2.get());
            RuntimeBindingRecord stored = bindings.findById(a.getBindingId());
            join(service.control("harness-1", "rs-1",
                    Map.of("kind", "manifest")));
            join(service.control("harness-2", "rs-2",
                    Map.of("kind", "manifest")));
            row("S1-a", provisioner.calls.get() == 1,
                    "provisioner calls for one workspace binding = "
                            + provisioner.calls.get());
            row("S1-b", a.getBindingId().equals(b.getBindingId())
                    && a.getRuntimeGeneration() == b.getRuntimeGeneration(),
                    "both Sessions on binding " + a.getBindingId()
                            + " generation " + a.getRuntimeGeneration());
            row("S1-c", stored.getLease().getLeaseId().equals("lease-1"),
                    "durable binding lease after the race = "
                            + stored.getLease().getLeaseId()
                            + " (state " + stored.getState() + ", version "
                            + stored.getVersion() + ")");
            List<String> routes = new ArrayList<>();
            for (String line : transport.log) {
                if (line.startsWith("control")) {
                    routes.add(line);
                }
            }
            boolean sameRoute = routes.size() == 2 && routes.get(0)
                    .substring(routes.get(0).indexOf(" via "))
                    .equals(routes.get(1).substring(
                            routes.get(1).indexOf(" via ")));
            row("S1-d", sameRoute, "control routes: " + routes);
        }
    }

    /** A repository failure before EXECUTING leaves an undrivable record. */
    static void s2StuckDispatching() {
        header("S2  repository fault between claimDispatch and EXECUTING");
        RuntimeScope scope = scope("s2", "workspace");
        MutableClock clock = new MutableClock(START);
        Provisioner provisioner = new Provisioner();
        Transport transport = new Transport();
        FaultyExecutionRepository executions = new FaultyExecutionRepository(
                new InMemoryToolExecutionRepository(clock));
        try (RuntimeBrokerService service = service(scope, provisioner,
                transport, new InMemoryRuntimeBindingRepository(clock,
                        () -> "binding-s2"),
                new InMemoryRuntimeSessionRepository(), executions,
                "broker", Duration.ofHours(1), MINUTE, clock)) {
            join(service.acquire("h", "rs", "bootstrap"));
            executions.failCasCall = executions.casCalls.get() + 1;
            String first = outcome(() -> service.createExecution("h", "rs",
                    "key-1", reference("rs", "call-1")));
            ToolExecutionRecord record = executions.findByIdempotencyKey(
                    "key-1");
            note("createExecution #1 -> " + first);
            note("stored: " + record.getState() + " owner="
                    + record.getDispatchOwner() + " gen="
                    + record.getDispatchGeneration());
            ToolExecutionRecord retry = join(service.createExecution("h",
                    "rs", "key-1", reference("rs", "call-1")));
            note("createExecution #2 (same key) -> ok, state "
                    + retry.getState());
            clock.advance(Duration.ofMinutes(5));
            ToolExecutionRecord later = join(service.createExecution("h",
                    "rs", "key-1", reference("rs", "call-1")));
            note("after the dispatch lease expired, createExecution #3 -> "
                    + later.getState());
            ToolExecutionRecord cancelled = join(service.cancelExecution(
                    "h", "rs", later.getExecutionCallId()));
            note("cancelExecution -> " + cancelled.getState()
                    + " cancelRequested=" + cancelled.isCancelRequested()
                    + ", transport.cancel calls="
                    + transport.cancelCalls.get());
            String release = outcome(() -> service.release("h", "rs"));
            note("release -> " + release);
            ToolExecutionRecord end = executions.findByIdempotencyKey(
                    "key-1");
            row("S2-a", transport.executeCalls.get() > 0
                    || end.isSettled()
                    || end.getState() == ToolExecutionRecord.State.UNKNOWN,
                    "after retry + lease expiry + cancel: state "
                            + end.getState() + ", execute calls "
                            + transport.executeCalls.get());
            row("S2-b", "ok".equals(release),
                    "Session release -> " + release);
        }
    }

    /** How each public call reports invalid input and failures. */
    static void s3ErrorSurface() {
        header("S3  error surface of the public service API");
        RuntimeScope scope = scope("s3", "workspace");
        Provisioner provisioner = new Provisioner();
        Transport transport = new Transport();
        InMemoryToolExecutionRepository executions =
                new InMemoryToolExecutionRepository();
        RuntimeBrokerService service = service(scope, provisioner, transport,
                new InMemoryRuntimeBindingRepository(),
                new InMemoryRuntimeSessionRepository(), executions,
                "broker", MINUTE, MINUTE, Clock.systemUTC());
        join(service.acquire("h", "rs", "bootstrap"));
        Map<String, Object> badDigest = Map.of("sessionId", "rs",
                "promptId", "p", "callId", "c");
        Map<String, java.util.function.Supplier<CompletionStage<?>>> calls =
                new java.util.LinkedHashMap<>();
        calls.put("acquire(harnessSessionId=\"\")",
                () -> service.acquire("", "rs-x", "bootstrap"));
        calls.put("acquire(turnKind=\"resume\")",
                () -> service.acquire("h", "rs-y", "resume"));
        calls.put("control(kind=\"shell\")",
                () -> service.control("h", "rs", Map.of("kind", "shell")));
        calls.put("control(operation=null)",
                () -> service.control("h", "rs", null));
        calls.put("createExecution(idempotencyKey=\"\")",
                () -> service.createExecution("h", "rs", "",
                        reference("rs", "c0")));
        calls.put("createExecution(reference w/o argsDigest)",
                () -> service.createExecution("h", "rs", "k-bad",
                        badDigest));
        calls.put("getExecution(executionCallId=\"\")",
                () -> service.getExecution("h", "rs", ""));
        calls.put("getExecution(unknown id)",
                () -> service.getExecution("h", "rs", "nope"));
        transport.execute = reference -> new CompletableFuture<>();
        ToolExecutionRecord running = join(service.createExecution("h",
                "rs", "k-run", reference("rs", "c1")));
        transport.cancel = reference -> CompletableFuture.completedFuture(
                Map.of("state", "settled", "result",
                        Map.of("executionStatus", "stopped")));
        calls.put("cancelExecution -> Runtime says settled/\"stopped\"",
                () -> service.cancelExecution("h", "rs",
                        running.getExecutionCallId()));
        for (Map.Entry<String, java.util.function.Supplier<
                CompletionStage<?>>> entry : calls.entrySet()) {
            String result = outcome(entry.getValue());
            boolean typed = result.contains("RuntimeBrokerException");
            boolean async = result.startsWith("async");
            String shape = (async ? "stage" : "throw") + "/"
                    + (typed ? "typed" : "untyped");
            System.out.printf("  %s%-13s%s %-48s %s%n",
                    typed && async ? G : Y, shape, N, entry.getKey(),
                    result.replaceFirst("^(sync|async) ", ""));
        }
        ToolExecutionRecord after = executions.findByExecutionCallId(
                running.getExecutionCallId());
        note("record after the invalid settled cancel: " + after.getState()
                + " cancelRequested=" + after.isCancelRequested());
        service.close();
        note("after close(): acquire -> " + outcome(() -> service.acquire(
                "h", "rs-z", "bootstrap")));
    }

    /** Cancellation ordering and evidence rules. */
    static void s4Cancellation() {
        header("S4  cancellation ordering and settlement evidence");
        RuntimeScope scope = scope("s4", "workspace");
        Provisioner provisioner = new Provisioner();
        Transport transport = new Transport();
        InMemoryToolExecutionRepository executions =
                new InMemoryToolExecutionRepository();
        try (RuntimeBrokerService service = service(scope, provisioner,
                transport, new InMemoryRuntimeBindingRepository(),
                new InMemoryRuntimeSessionRepository(), executions,
                "broker", MINUTE, MINUTE, Clock.systemUTC())) {
            join(service.acquire("h", "rs", "bootstrap"));
            CompletableFuture<Map<String, Object>> execute =
                    new CompletableFuture<>();
            transport.execute = reference -> execute;
            ToolExecutionRecord running = join(service.createExecution("h",
                    "rs", "k1", reference("rs", "c1")));
            AtomicReference<ToolExecutionRecord.State> seen =
                    new AtomicReference<>();
            transport.onCancel = () -> seen.set(executions
                    .findByExecutionCallId(running.getExecutionCallId())
                    .getState());
            ToolExecutionRecord ack = join(service.cancelExecution("h", "rs",
                    running.getExecutionCallId()));
            row("S4-a", seen.get() == ToolExecutionRecord.State
                    .CANCEL_REQUESTED, "state persisted when transport.cancel"
                            + " ran = " + seen.get());
            row("S4-b", ack.getState() == ToolExecutionRecord.State
                    .CANCEL_REQUESTED, "non-terminal ack leaves "
                            + ack.getState());
            transport.cancel = reference -> CompletableFuture.completedFuture(
                    Map.of("state", "settled", "result",
                            Map.of("executionStatus", "cancelled")));
            ToolExecutionRecord settled = join(service.cancelExecution("h",
                    "rs", running.getExecutionCallId()));
            execute.complete(Map.of("executionStatus", "success"));
            ToolExecutionRecord end = executions.findByExecutionCallId(
                    running.getExecutionCallId());
            row("S4-c", settled.isSettled()
                    && "cancelled".equals(end.getExecutionStatus()),
                    "settled evidence wins over a late success: "
                            + end.getState() + "/" + end.getExecutionStatus());
            String released = outcome(() -> service.release("h", "rs"));
            row("S4-d", "ok".equals(released), "release after settle -> "
                    + released);
        }
    }

    /** One physical dispatch per idempotency key under real threads. */
    static void s5Concurrency() throws Exception {
        header("S5  32 threads x same key, then 32 distinct keys");
        RuntimeScope scope = scope("s5", "workspace");
        Provisioner provisioner = new Provisioner();
        Transport transport = new Transport();
        InMemoryToolExecutionRepository executions =
                new InMemoryToolExecutionRepository();
        List<CompletableFuture<Map<String, Object>>> pending =
                java.util.Collections.synchronizedList(new ArrayList<>());
        transport.execute = reference -> {
            CompletableFuture<Map<String, Object>> f =
                    new CompletableFuture<>();
            pending.add(f);
            return f;
        };
        try (RuntimeBrokerService service = service(scope, provisioner,
                transport, new InMemoryRuntimeBindingRepository(),
                new InMemoryRuntimeSessionRepository(), executions,
                "broker", MINUTE, MINUTE, Clock.systemUTC())) {
            List<Thread> threads = new ArrayList<>();
            CyclicBarrier barrier = new CyclicBarrier(32);
            Set<String> acquired = java.util.concurrent.ConcurrentHashMap
                    .newKeySet();
            for (int i = 0; i < 32; i++) {
                threads.add(new Thread(() -> {
                    try {
                        barrier.await();
                        acquired.add(join(service.acquire("h", "rs",
                                "bootstrap")).getRuntimeSessionId());
                    } catch (Exception exception) {
                        acquired.add("error " + exception);
                    }
                }));
            }
            threads.forEach(Thread::start);
            for (Thread thread : threads) {
                thread.join();
            }
            row("S5-a", provisioner.calls.get() == 1
                    && transport.acquireCalls.get() == 1,
                    "32 concurrent acquire: provision "
                            + provisioner.calls.get() + ", Runtime acquire "
                            + transport.acquireCalls.get());
            Set<String> ids = java.util.concurrent.ConcurrentHashMap
                    .newKeySet();
            threads.clear();
            CyclicBarrier barrier2 = new CyclicBarrier(32);
            for (int i = 0; i < 32; i++) {
                threads.add(new Thread(() -> {
                    try {
                        barrier2.await();
                        ids.add(join(service.createExecution("h", "rs",
                                "same-key", reference("rs", "same")))
                                .getExecutionCallId());
                    } catch (Exception exception) {
                        ids.add("error " + exception);
                    }
                }));
            }
            threads.forEach(Thread::start);
            for (Thread thread : threads) {
                thread.join();
            }
            row("S5-b", ids.size() == 1 && transport.executeCalls.get() == 1,
                    "same key: distinct records " + ids.size()
                            + ", physical execute " + transport.executeCalls
                                    .get());
            threads.clear();
            CyclicBarrier barrier3 = new CyclicBarrier(32);
            for (int i = 0; i < 32; i++) {
                int index = i;
                threads.add(new Thread(() -> {
                    try {
                        barrier3.await();
                        join(service.createExecution("h", "rs", "k-" + index,
                                reference("rs", "c-" + index)));
                    } catch (Exception exception) {
                        ids.add("error " + exception);
                    }
                }));
            }
            threads.forEach(Thread::start);
            for (Thread thread : threads) {
                thread.join();
            }
            row("S5-c", transport.executeCalls.get() == 33,
                    "32 distinct keys: physical execute total "
                            + transport.executeCalls.get() + " (expect 33)");
            String busy = outcome(() -> service.release("h", "rs"));
            row("S5-d", busy.contains("runtime_session_busy"),
                    "release while 33 in flight -> " + busy);
            new ArrayList<>(pending).forEach(f -> f.complete(
                    Map.of("executionStatus", "success")));
            await(() -> !executions.hasActiveByRuntimeSession("rs"),
                    "settle");
            String released = outcome(() -> service.release("h", "rs"));
            row("S5-e", "ok".equals(released), "release after all settle -> "
                    + released);
        }
    }

    /** UNKNOWN is unsettled, and nothing in this slice resolves it. */
    static void s6UnknownPinsSession() {
        header("S6  ambiguous execute -> UNKNOWN, then release");
        RuntimeScope scope = scope("s6", "workspace");
        MutableClock clock = new MutableClock(START);
        Provisioner provisioner = new Provisioner();
        Transport transport = new Transport();
        InMemoryToolExecutionRepository executions =
                new InMemoryToolExecutionRepository(clock);
        transport.execute = reference -> CompletableFuture.failedFuture(
                new java.io.UncheckedIOException(
                        new java.io.IOException("connection reset")));
        try (RuntimeBrokerService service = service(scope, provisioner,
                transport, new InMemoryRuntimeBindingRepository(clock,
                        () -> "binding-s6"),
                new InMemoryRuntimeSessionRepository(), executions,
                "broker", Duration.ofHours(1), MINUTE, clock)) {
            join(service.acquire("h", "rs", "bootstrap"));
            ToolExecutionRecord record = join(service.createExecution("h",
                    "rs", "k", reference("rs", "c")));
            row("S6-a", record.getState() == ToolExecutionRecord.State.UNKNOWN,
                    "transport failure -> " + record.getState()
                            + " (execute calls " + transport.executeCalls.get()
                            + ", no replay)");
            ToolExecutionRecord retry = join(service.createExecution("h",
                    "rs", "k", reference("rs", "c")));
            row("S6-b", transport.executeCalls.get() == 1,
                    "retry of the same key -> " + retry.getState()
                            + ", execute calls " + transport.executeCalls
                                    .get());
            clock.advance(Duration.ofDays(1));
            String release = outcome(() -> service.release("h", "rs"));
            note("release one day later -> " + release
                    + "  (design: UNKNOWN waits for the reconciliation slice)");
        }
    }

    /** Another Harness Session cannot touch a Session it does not own. */
    static void s7CrossHarness() {
        header("S7  Harness Session B against Harness Session A's objects");
        RuntimeScope scope = scope("s7", "workspace");
        Provisioner provisioner = new Provisioner();
        Transport transport = new Transport();
        InMemoryToolExecutionRepository executions =
                new InMemoryToolExecutionRepository();
        transport.execute = reference -> new CompletableFuture<>();
        try (RuntimeBrokerService service = service(scope, provisioner,
                transport, new InMemoryRuntimeBindingRepository(),
                new InMemoryRuntimeSessionRepository(), executions,
                "broker", MINUTE, MINUTE, Clock.systemUTC())) {
            join(service.acquire("A", "rs-a", "bootstrap"));
            join(service.acquire("B", "rs-b", "bootstrap"));
            ToolExecutionRecord a = join(service.createExecution("A", "rs-a",
                    "key-a", reference("rs-a", "ca")));
            int before = transport.log.size();
            Map<String, java.util.function.Supplier<CompletionStage<?>>> calls =
                    new java.util.LinkedHashMap<>();
            calls.put("acquire(B, rs-a)", () -> service.acquire("B", "rs-a",
                    "bootstrap"));
            calls.put("control(B, rs-a)", () -> service.control("B", "rs-a",
                    Map.of("kind", "history")));
            calls.put("createExecution(B, rs-a)", () -> service
                    .createExecution("B", "rs-a", "key-b",
                            reference("rs-a", "cb")));
            calls.put("createExecution(B, rs-b, key-a)", () -> service
                    .createExecution("B", "rs-b", "key-a",
                            reference("rs-b", "ca")));
            calls.put("getExecution(B, rs-b, A's id)", () -> service
                    .getExecution("B", "rs-b", a.getExecutionCallId()));
            calls.put("getExecution(B, rs-b, missing id)", () -> service
                    .getExecution("B", "rs-b", "no-such-id"));
            calls.put("cancelExecution(B, rs-b, A's id)", () -> service
                    .cancelExecution("B", "rs-b", a.getExecutionCallId()));
            calls.put("release(B, rs-a)", () -> service.release("B",
                    "rs-a"));
            boolean allRefused = true;
            for (Map.Entry<String, java.util.function.Supplier<
                    CompletionStage<?>>> entry : calls.entrySet()) {
                String result = outcome(entry.getValue());
                allRefused &= !"ok".equals(result);
                System.out.printf("  %-5s %-36s %s%n", "", entry.getKey(),
                        result);
            }
            ToolExecutionRecord stillA = executions.findByExecutionCallId(
                    a.getExecutionCallId());
            row("S7-a", allRefused, "every cross-Session call refused");
            row("S7-b", transport.log.size() == before
                    && !stillA.isCancelRequested(),
                    "Runtime calls caused by B: " + (transport.log.size()
                            - before) + "; A's execution " + stillA.getState()
                            + " cancelRequested=" + stillA.isCancelRequested());
        }
    }

    /** failBinding has no PR test; pin FAILED + retry at the next generation. */
    static void s8ProvisionFailure() {
        header("S8  provisioning failure, null lease, and claim loss");
        RuntimeScope scope = scope("s8", "workspace");
        MutableClock clock = new MutableClock(START);
        Provisioner provisioner = new Provisioner();
        Transport transport = new Transport();
        InMemoryRuntimeBindingRepository bindings =
                new InMemoryRuntimeBindingRepository(clock,
                        new java.util.function.Supplier<String>() {
                            int next;

                            @Override
                            public String get() {
                                return "binding-" + (++next);
                            }
                        });
        CompletableFuture<RuntimeLease> slow = new CompletableFuture<>();
        provisioner.behaviour = call -> switch (call) {
            case 1 -> CompletableFuture.failedFuture(
                    new IllegalStateException("quota exceeded"));
            case 2 -> CompletableFuture.completedFuture(null);
            case 3 -> slow;
            default -> CompletableFuture.completedFuture(lease(call));
        };
        try (RuntimeBrokerService service = service(scope, provisioner,
                transport, bindings, new InMemoryRuntimeSessionRepository(),
                new InMemoryToolExecutionRepository(clock), "broker",
                MINUTE, MINUTE, clock)) {
            String w1 = outcome(() -> service.warm("h"));
            RuntimeBindingRecord b1 = bindings.findById("binding-1");
            row("S8-a", b1.getState() == RuntimeBindingRecord.State.FAILED,
                    "provisioner error -> " + w1 + "; binding-1 "
                            + b1.getState());
            String w2 = outcome(() -> service.warm("h"));
            RuntimeBindingRecord b2 = bindings.findById("binding-2");
            row("S8-b", b2 != null && b2.getGeneration() == 2
                    && b2.getState() == RuntimeBindingRecord.State.FAILED,
                    "retry -> generation " + (b2 == null ? "-"
                            : b2.getGeneration()) + "; null lease -> " + w2
                            + "; " + (b2 == null ? "-" : b2.getState()));
            CompletionStage<RuntimeBindingRecord> w3 = service.warm("h");
            RuntimeBindingRecord b3 = bindings.findById("binding-3");
            clock.advance(Duration.ofMinutes(2));
            RuntimeBindingRecord stolen = bindings.claimOperation(
                    "binding-3", "other-broker", MINUTE);
            slow.complete(lease(3));
            String r3 = outcome(() -> w3);
            RuntimeBindingRecord after = bindings.findById("binding-3");
            row("S8-c", r3.contains("runtime_provision_fenced")
                    && after.getState() == RuntimeBindingRecord.State
                            .PROVISIONING && after.getLease() == null,
                    "claim expired and taken by other-broker (gen "
                            + stolen.getOperationGeneration() + "): late lease"
                            + " -> " + r3 + "; stored " + after.getState()
                            + " lease=" + after.getLease() + " owner="
                            + after.getOperationOwner());
        }
    }

    /** Negative release ack keeps RELEASING; retry is idempotent. */
    static void s9ReleaseRetry() {
        header("S9  release: negative ack, retry, repeat, re-acquire");
        RuntimeScope scope = scope("s9", "workspace");
        Provisioner provisioner = new Provisioner();
        Transport transport = new Transport();
        InMemoryRuntimeSessionRepository sessions =
                new InMemoryRuntimeSessionRepository();
        try (RuntimeBrokerService service = service(scope, provisioner,
                transport, new InMemoryRuntimeBindingRepository(), sessions,
                new InMemoryToolExecutionRepository(), "broker", MINUTE,
                MINUTE, Clock.systemUTC())) {
            join(service.acquire("h", "rs", "bootstrap"));
            transport.release = CompletableFuture.completedFuture(false);
            Boolean first = join(service.release("h", "rs"));
            RuntimeSessionRecord s1 = sessions.findById(scope, "rs");
            String control = outcome(() -> service.control("h", "rs",
                    Map.of("kind", "history")));
            row("S9-a", !first && s1.getState()
                    == RuntimeSessionRecord.State.RELEASING
                    && control.contains("not_ready"),
                    "negative ack -> " + first + ", " + s1.getState()
                            + ", control -> " + control);
            transport.release = CompletableFuture.completedFuture(true);
            Boolean second = join(service.release("h", "rs"));
            int calls = transport.releaseCalls.get();
            Boolean third = join(service.release("h", "rs"));
            row("S9-b", second && third
                    && transport.releaseCalls.get() == calls,
                    "retry -> " + second + ", repeat -> " + third
                            + " without another Runtime call ("
                            + transport.releaseCalls.get() + " total)");
            String again = outcome(() -> service.acquire("h", "rs",
                    "bootstrap"));
            row("S9-c", again.contains("not_acquirable"),
                    "re-acquire a RELEASED id -> " + again);
        }
    }

    /** Transport calls run while the Session monitor is held. */
    static void s10BlockingTransport() throws Exception {
        header("S10 a transport whose execute() blocks before returning its stage");
        RuntimeScope scope = scope("s10", "workspace");
        Provisioner provisioner = new Provisioner();
        Transport transport = new Transport();
        InMemoryToolExecutionRepository executions =
                new InMemoryToolExecutionRepository();
        transport.execute = reference -> {
            sleep(2000);
            return CompletableFuture.completedFuture(
                    Map.of("executionStatus", "success"));
        };
        try (RuntimeBrokerService service = service(scope, provisioner,
                transport, new InMemoryRuntimeBindingRepository(),
                new InMemoryRuntimeSessionRepository(), executions,
                "broker", MINUTE, MINUTE, Clock.systemUTC())) {
            join(service.acquire("h", "rs", "bootstrap"));
            Thread runner = new Thread(() -> join(service.createExecution(
                    "h", "rs", "k", reference("rs", "c"))));
            runner.start();
            await(() -> transport.executeCalls.get() == 1, "execute");
            long started = System.nanoTime();
            ToolExecutionRecord seen = executions.findByIdempotencyKey("k");
            ToolExecutionRecord cancelled = join(service.cancelExecution("h",
                    "rs", seen.getExecutionCallId()));
            long millis = (System.nanoTime() - started) / 1_000_000;
            runner.join();
            note("cancel issued while EXECUTING; it returned after " + millis
                    + " ms with " + cancelled.getState() + "/"
                    + cancelled.getExecutionStatus()
                    + ", transport.cancel calls=" + transport.cancelCalls.get());
        }
    }

    /** warm() hands the attested lease, token included, to its caller. */
    static void s11WarmReturnsToken() {
        header("S11 what warm() returns to the embedding caller");
        RuntimeScope scope = scope("s11", "workspace");
        try (RuntimeBrokerService service = service(scope, new Provisioner(),
                new Transport(), new InMemoryRuntimeBindingRepository(),
                new InMemoryRuntimeSessionRepository(),
                new InMemoryToolExecutionRepository(), "broker", MINUTE,
                MINUTE, Clock.systemUTC())) {
            RuntimeBindingRecord record = join(service.warm("h"));
            note("warm(h).getLease() -> endpoint="
                    + record.getLease().getEndpoint() + " token="
                    + record.getLease().getToken() + " leaseId="
                    + record.getLease().getLeaseId());
        }
    }

    /** A dispatch whose claim was taken over cannot settle its late result. */
    static void s12StaleDispatchOwner() {
        header("S12 stale dispatch owner: lease expires, another owner claims, late result arrives");
        RuntimeScope scope = scope("s12", "workspace");
        MutableClock clock = new MutableClock(START);
        Transport transport = new Transport();
        InMemoryToolExecutionRepository executions =
                new InMemoryToolExecutionRepository(clock);
        CompletableFuture<Map<String, Object>> late = new CompletableFuture<>();
        transport.execute = reference -> late;
        try (RuntimeBrokerService service = service(scope, new Provisioner(),
                transport, new InMemoryRuntimeBindingRepository(clock,
                        () -> "binding-s12"),
                new InMemoryRuntimeSessionRepository(), executions,
                "broker", Duration.ofHours(1), MINUTE, clock)) {
            join(service.acquire("h", "rs", "bootstrap"));
            ToolExecutionRecord running = join(service.createExecution("h",
                    "rs", "k", reference("rs", "c")));
            clock.advance(Duration.ofMinutes(2));
            ToolExecutionRecord taken = executions.claimDispatch(
                    running.getExecutionCallId(), "broker-2", MINUTE);
            ToolExecutionRecord fenced = executions.findByExecutionCallId(
                    running.getExecutionCallId());
            late.complete(Map.of("executionStatus", "success"));
            ToolExecutionRecord end = executions.findByExecutionCallId(
                    running.getExecutionCallId());
            row("S12", end.getState() == ToolExecutionRecord.State.UNKNOWN
                    && end.getResult() == null,
                    "takeover by broker-2 -> claim " + taken + ", record "
                            + fenced.getState() + "; late success from the "
                            + "old dispatch -> " + end.getState()
                            + " result=" + end.getResult());
        }
    }

    /** Other ways to leave an execution that no dispatcher serves. */
    static void s2bNoProgressPaths() {
        header("S2b same class without a repository fault, and the other exits");
        for (String variant : List.of("stall", "cancel", "late", "commit")) {
            RuntimeScope scope = scope("s2b-" + variant, "workspace");
            MutableClock clock = new MutableClock(START);
            Transport transport = new Transport();
            FaultyExecutionRepository executions =
                    new FaultyExecutionRepository(
                            new InMemoryToolExecutionRepository(clock));
            CompletableFuture<Map<String, Object>> late =
                    new CompletableFuture<>();
            if ("late".equals(variant)) {
                transport.execute = reference -> late;
            }
            try (RuntimeBrokerService service = service(scope,
                    new Provisioner(), transport,
                    new InMemoryRuntimeBindingRepository(clock,
                            () -> "binding-" + variant),
                    new InMemoryRuntimeSessionRepository(), executions,
                    "broker", Duration.ofHours(1), MINUTE, clock)) {
                join(service.acquire("h", "rs", "bootstrap"));
                String label;
                switch (variant) {
                    case "stall" -> {
                        label = "stall > dispatch lease after claimDispatch "
                                + "(no exception), then retry";
                        executions.afterClaim = () -> clock.advance(
                                Duration.ofMinutes(2));
                    }
                    case "cancel" -> {
                        label = "repository fault before EXECUTING, then the "
                                + "client cancels instead of retrying";
                        executions.failCasCall = executions.casCalls.get() + 1;
                    }
                    case "late" -> label = "execute result arrives after the "
                            + "dispatch lease lapsed, then retry";
                    default -> {
                        label = "EXECUTING write commits, then the repository "
                                + "throws; retry after lease expiry";
                        executions.commitThenFailCasCall =
                                executions.casCalls.get() + 1;
                    }
                }
                String first = outcome(() -> service.createExecution("h",
                        "rs", "k", reference("rs", "c")));
                ToolExecutionRecord stored = executions.findByIdempotencyKey(
                        "k");
                if ("late".equals(variant)) {
                    clock.advance(Duration.ofMinutes(2));
                    late.complete(Map.of("executionStatus", "success"));
                }
                if ("commit".equals(variant)) {
                    clock.advance(Duration.ofMinutes(2));
                }
                ToolExecutionRecord after = "cancel".equals(variant)
                        ? join(service.cancelExecution("h", "rs",
                                stored.getExecutionCallId()))
                        : join(service.createExecution("h", "rs", "k",
                                reference("rs", "c")));
                String release = outcome(() -> service.release("h", "rs"));
                boolean ok = after.isSettled() || after.getState()
                        == ToolExecutionRecord.State.UNKNOWN;
                row("S2b-" + variant, ok, label);
                note("        first call " + first.replaceFirst(
                        "RuntimeBrokerException", "RBE") + "; then "
                        + after.getState()
                        + (after.getExecutionStatus() == null ? ""
                                : "/" + after.getExecutionStatus())
                        + ", execute calls " + transport.executeCalls.get()
                        + ", release " + release.replaceFirst(
                                "async RuntimeBrokerException", "RBE"));
            }
        }
    }
}
