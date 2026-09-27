package com.alibaba.qwen.code.runtimebroker;

import static com.alibaba.qwen.code.runtimebroker.FaultGateRig.HARNESS;
import static com.alibaba.qwen.code.runtimebroker.FaultGateRig.SESSION;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Verification probes for the W0e design (PR 12839). Each probe pins what
 * the merged Broker does today, with real Broker JVMs, real bundled workers
 * and file-backed H2, and appends evidence lines to $W0E_OUT/<probe>.log.
 */
@Tag("fault-gate")
class W0eProbeTest {
    private static final Path OUT = Path.of(System.getenv()
            .getOrDefault("W0E_OUT", System.getProperty("java.io.tmpdir")));
    /**
     * Double-forks into a new session so the writer is neither in the tool's
     * process group nor below the worker, then appends a millisecond stamp to
     * "escaped" every 200 ms for at most 120 s.
     */
    private static final String ESCAPE = String.join("\n",
            "use POSIX (); use Time::HiRes ();",
            "exit 0 if fork;",
            "POSIX::setsid();",
            "exit 0 if fork;",
            "open STDIN, '<', '/dev/null'; open STDOUT, '>', '/dev/null';",
            "open STDERR, '>', '/dev/null';",
            "open my $p, '>', 'escaped.pid'; print $p \"$$\\n\"; close $p;",
            "for (1..600) { open my $f, '>>', 'escaped';",
            "  printf $f \"old %d\\n\", int(Time::HiRes::time()*1000);",
            "  close $f; Time::HiRes::sleep(0.2); }",
            "");
    private static final String STAMP =
            "perl -MTime::HiRes -e 'printf \"%d\\n\","
                    + " int(Time::HiRes::time()*1000)'";

    private FaultGateRig rig;
    private final List<Long> escapedPids = new ArrayList<>();
    private final List<BrokerProcess> extraBrokers = new ArrayList<>();

    @BeforeEach
    void openRig() throws Exception {
        Files.createDirectories(OUT);
        rig = FaultGateRig.open();
    }

    @AfterEach
    void closeRig() throws Exception {
        for (long pid : escapedPids) {
            ProcessHandle.of(pid).ifPresent(ProcessHandle::destroyForcibly);
        }
        for (BrokerProcess broker : extraBrokers) {
            broker.close();
        }
        if (rig != null) {
            rig.close();
        }
    }

    /**
     * P1: a worker dies under a live Broker while a Shell descendant it
     * started has escaped. Today the generation is retired as FAILED and a
     * replacement serves new work in the same directory while the old
     * writer keeps writing.
     */
    @Test
    void p1EscapedWriterKeepsWritingBesideTheReplacement() throws Exception {
        String probe = "p1-escaped-writer";
        Files.writeString(rig.workspace.resolve("escape.pl"), ESCAPE);
        BrokerProcess broker = rig.broker("broker", rig.proxy(),
                FaultGateRig.Provisioner.LOCAL_PROCESS);
        acquire(broker, SESSION);
        String execution = broker.create(HARNESS, SESSION, "key-1",
                FaultGateRig.shell("call-1", "perl escape.pl;"
                        + " echo start >> marker; sleep 30;"
                        + " echo end >> marker")).object()
                .getString("executionCallId");
        rig.awaitMarker("marker", List.of("start"));
        long writer = awaitEscapedPid();
        FaultGateRig.await(() -> escaped().size(), n -> n >= 5,
                "escaped writer running");
        RuntimeBindingRecord before = rig.execution(execution) == null
                ? null : rig.bindings.findById(
                        rig.execution(execution).getBindingId());
        List<ProcessHandle> workers = broker.workers();
        log(probe, "old binding " + before.getBindingId() + " generation "
                + before.getGeneration() + " state " + before.getState());
        log(probe, "worker pid " + workers.get(0).pid() + " descendants "
                + workers.get(0).descendants().map(p -> p.pid()).toList());
        log(probe, "escaped writer pid " + writer + " parent "
                + parent(writer) + " (not below the worker)");

        rig.killWorker(broker);
        log(probe, "SIGKILLed worker tree " + workers.get(0).pid()
                + "; worker alive=" + workers.get(0).isAlive());

        ToolExecutionRecord unknown = rig.awaitExecution(execution,
                record -> record.getState()
                        == ToolExecutionRecord.State.UNKNOWN,
                "UNKNOWN execution");
        log(probe, "old execution " + execution + " state "
                + unknown.getState() + " result " + unknown.getResult());
        BrokerProcess.Reply firstWarm = broker.warm(HARNESS);
        log(probe, "warm #1 -> ok=" + firstWarm.ok() + " "
                + (firstWarm.ok() ? firstWarm.value() : firstWarm.status()
                        + " " + firstWarm.code()));
        RuntimeBindingRecord retired = FaultGateRig.await(
                () -> rig.bindings.findById(before.getBindingId()),
                record -> record.getState()
                        == RuntimeBindingRecord.State.FAILED,
                "old binding retired");
        log(probe, "old binding state " + retired.getState()
                + " (no pin check: execution still " + rig.execution(
                        execution).getState() + ")");

        JSONObject replacement = firstWarm.ok() ? (JSONObject) firstWarm
                .value() : broker.warm(HARNESS).object();
        log(probe, "warm -> " + replacement);
        acquire(broker, "runtime-session-2");
        String next = broker.create(HARNESS, "runtime-session-2", "key-2",
                FaultGateRig.shell("runtime-session-2", "call-2",
                        STAMP + " >> newgen; echo new-generation"
                                + " >> marker2")).object()
                .getString("executionCallId");
        ToolExecutionRecord settled = rig.awaitExecution(next,
                record -> record.isSettled(), "replacement call settled");
        long firstNewWrite = Long.parseLong(Files.readAllLines(
                rig.workspace.resolve("newgen")).get(0).trim());
        log(probe, "replacement execution " + next + " state "
                + settled.getState() + " status "
                + settled.getExecutionStatus() + " binding "
                + settled.getBindingId() + " generation "
                + settled.getRuntimeGeneration());
        Thread.sleep(3_000);
        List<Long> stamps = escaped();
        long after = stamps.stream().filter(t -> t > firstNewWrite).count();
        log(probe, "replacement first write at " + firstNewWrite
                + "; escaped writes after it: " + after + " of "
                + stamps.size() + "; writer alive="
                + ProcessHandle.of(writer).map(ProcessHandle::isAlive)
                        .orElse(false));

        assertEquals(ToolExecutionRecord.State.UNKNOWN, unknown.getState());
        assertEquals(RuntimeBindingRecord.State.FAILED, retired.getState());
        assertEquals("READY", replacement.getString("state"));
        assertNotEquals(before.getBindingId(),
                replacement.getString("bindingId"));
        assertTrue(after > 0, "the old writer stopped before reuse");
    }

    /**
     * P2: #12670's pin on a LOST generation is only as strong as every
     * Broker that still holds a Session context for it. A second Broker
     * proves the worker gone and pins the generation; the first, still
     * alive, retires the same binding as FAILED on its unusable-lease path,
     * and the placement is provisioned again with the call unsettled.
     */
    @Test
    void p2AStaleBrokerRetiresThePinnedLostGeneration() throws Exception {
        String probe = "p2-stale-broker";
        BrokerProcess first = rig.broker("first", rig.proxy(),
                FaultGateRig.Provisioner.RECOVERABLE);
        acquire(first, SESSION);
        String execution = first.create(HARNESS, SESSION, "key-1",
                FaultGateRig.shell("call-1", "echo start >> marker;"
                        + " sleep 20; echo end >> marker")).object()
                .getString("executionCallId");
        rig.awaitMarker("marker", List.of("start"));
        RuntimeBindingRecord before = rig.activeBinding();
        List<ProcessHandle> workers = first.workers();
        log(probe, "binding " + before.getBindingId() + " generation "
                + before.getGeneration() + " state " + before.getState());

        first.pause();
        workers.forEach(worker -> ProcessTrees.kill(worker,
                FaultGateRig.WAIT));
        log(probe, "first Broker SIGSTOPped; worker tree "
                + workers.stream().map(ProcessHandle::pid).toList()
                + " SIGKILLed");
        BrokerProcess second = rig.broker("second", rig.proxy(),
                FaultGateRig.Provisioner.RECOVERABLE);
        BrokerProcess.Reply pinned = second.warm(HARNESS);
        RuntimeBindingRecord lost = rig.bindings.findById(
                before.getBindingId());
        log(probe, "second.warm -> ok=" + pinned.ok() + " code "
                + pinned.code() + "; binding state " + lost.getState()
                + "; execution " + rig.execution(execution).getState());

        first.resume();
        BrokerProcess.Reply release = first.release(HARNESS, SESSION);
        RuntimeBindingRecord flipped = rig.bindings.findById(
                before.getBindingId());
        log(probe, "first (stale) resumed; first.release -> ok="
                + release.ok() + " code " + release.code()
                + "; binding state now " + flipped.getState());

        BrokerProcess.Reply rewarm = second.warm(HARNESS);
        log(probe, "second.warm -> ok=" + rewarm.ok() + " "
                + (rewarm.ok() ? rewarm.value() : rewarm.code()));
        ToolExecutionRecord old = rig.execution(execution);
        log(probe, "old execution " + execution + " state "
                + old.getState() + " (generation " + old.getRuntimeGeneration()
                + ")");
        String next = null;
        if (rewarm.ok()) {
            acquire(second, "runtime-session-2");
            next = second.create(HARNESS, "runtime-session-2", "key-2",
                    FaultGateRig.shell("runtime-session-2", "call-2",
                            "echo replacement >> marker2")).object()
                    .getString("executionCallId");
            ToolExecutionRecord ran = rig.awaitExecution(next,
                    ToolExecutionRecord::isSettled, "replacement settled");
            log(probe, "replacement execution " + next + " "
                    + ran.getState() + " " + ran.getExecutionStatus()
                    + " on generation " + ran.getRuntimeGeneration()
                    + "; marker2=" + rig.marker("marker2"));
        }

        assertFalse(pinned.ok());
        assertEquals("runtime_broker_runtime_lost", pinned.code());
        assertEquals(RuntimeBindingRecord.State.LOST, lost.getState());
        assertEquals(RuntimeBindingRecord.State.FAILED, flipped.getState());
        assertTrue(rewarm.ok(), "the LOST pin held");
        assertFalse(old.isSettled());
    }

    /**
     * P2b: after a second Broker commits LOST, the stale Broker still admits a
     * new call into that generation, and its dispatch retires the binding as
     * FAILED. Reconcile polls, by contrast, leave LOST alone.
     */
    @Test
    void p2bAStaleBrokerAdmitsANewCallIntoTheLostGeneration()
            throws Exception {
        String probe = "p2b-late-admission";
        BrokerProcess first = rig.broker("first", rig.proxy(),
                FaultGateRig.Provisioner.RECOVERABLE);
        acquire(first, SESSION);
        String execution = first.create(HARNESS, SESSION, "key-1",
                FaultGateRig.shell("call-1", "echo start >> marker;"
                        + " sleep 20; echo end >> marker")).object()
                .getString("executionCallId");
        rig.awaitMarker("marker", List.of("start"));
        RuntimeBindingRecord before = rig.activeBinding();
        List<ProcessHandle> workers = first.workers();
        first.pause();
        workers.forEach(worker -> ProcessTrees.kill(worker,
                FaultGateRig.WAIT));
        BrokerProcess second = rig.broker("second", rig.proxy(),
                FaultGateRig.Provisioner.RECOVERABLE);
        BrokerProcess.Reply pinned = second.warm(HARNESS);
        RuntimeBindingRecord lost = rig.bindings.findById(
                before.getBindingId());
        log(probe, "second.warm -> " + pinned.code() + "; binding "
                + lost.getState() + "; execution "
                + rig.execution(execution).getState());
        first.resume();
        BrokerProcess.Reply early = first.reconcile(HARNESS, SESSION,
                execution);
        log(probe, "first (stale) reconcile poll while EXECUTING -> ok="
                + early.ok() + " " + (early.ok() ? JSON.toJSONString(
                        ((JSONObject) early.value()).getString("outcome"))
                        : early.code()) + "; binding "
                + rig.bindings.findById(before.getBindingId()).getState());
        rig.awaitExecution(execution, record -> record.getState()
                == ToolExecutionRecord.State.UNKNOWN,
                "stale Broker marks the call UNKNOWN");
        log(probe, "first marked call-1 UNKNOWN (its dispatch to the dead"
                + " worker failed); binding "
                + rig.bindings.findById(before.getBindingId()).getState());
        BrokerProcess.Reply poll = first.reconcile(HARNESS, SESSION,
                execution);
        RuntimeBindingRecord flipped = rig.bindings.findById(
                before.getBindingId());
        log(probe, "first (stale) reconcile poll on UNKNOWN -> ok=" + poll.ok()
                + " " + (poll.ok() ? poll.value() : poll.status() + " "
                        + poll.code()) + "; binding now "
                + flipped.getState());
        // A new call through the stale Session context: admission after
        // the loss was committed by the other Broker.
        BrokerProcess.Reply late = first.create(HARNESS, SESSION, "key-2",
                FaultGateRig.shell("call-2", "echo late >> marker"));
        String lateId = late.ok() ? ((JSONObject) late.value())
                .getString("executionCallId") : null;
        ToolExecutionRecord lateRecord = lateId == null ? null
                : rig.execution(lateId);
        RuntimeBindingRecord afterCreate = rig.bindings.findById(
                before.getBindingId());
        log(probe, "first (stale) create key-2 -> ok=" + late.ok() + " "
                + (late.ok() ? JSON.toJSONString(late.value())
                        : late.status() + " " + late.code()));
        log(probe, "late row: " + (lateRecord == null ? "none"
                : lateRecord.getState() + " on binding "
                        + lateRecord.getBindingId().substring(0, 8)
                        + " generation " + lateRecord.getRuntimeGeneration())
                + "; binding now " + afterCreate.getState());
        BrokerProcess.Reply rewarm = second.warm(HARNESS);
        log(probe, "second.warm -> ok=" + rewarm.ok() + " "
                + (rewarm.ok() ? rewarm.value() : rewarm.code())
                + "; old execution " + rig.execution(execution).getState()
                + "; marker=" + rig.marker("marker"));
        assertEquals("runtime_broker_runtime_lost", pinned.code());
        assertEquals(RuntimeBindingRecord.State.LOST, lost.getState());
        assertEquals(RuntimeBindingRecord.State.LOST, flipped.getState());
    }

    /**
     * P3: the production provisioner after an orderly Broker shutdown. The
     * worker is terminated, the durable binding stays READY, and a restarted
     * Broker observes UNKNOWN until four operation leases pass, every time.
     */
    @Test
    void p3OrderlyShutdownLeavesAReadyBindingNobodyCanReconcile()
            throws Exception {
        String probe = "p3-orderly-shutdown";
        BrokerProcess first = rig.broker("first", rig.proxy(),
                FaultGateRig.Provisioner.LOCAL_PROCESS);
        acquire(first, SESSION);
        ProcessHandle worker = first.workers().get(0);
        RuntimeBindingRecord before = rig.activeBinding();
        long closeAt = System.nanoTime();
        first.close();
        boolean exited = worker.onExit().toCompletableFuture()
                .completeOnTimeout(null, 30, java.util.concurrent.TimeUnit
                        .SECONDS).get() != null || !worker.isAlive();
        log(probe, "orderly close; worker " + worker.pid() + " exited="
                + exited + " after " + millis(closeAt) + " ms");
        RuntimeBindingRecord afterClose = rig.bindings.findById(
                before.getBindingId());
        log(probe, "binding " + before.getBindingId() + " state after close "
                + afterClose.getState() + " (lease endpoint "
                + afterClose.getLease().getEndpoint() + ")");

        for (long leaseMillis : new long[] {2_000, 5_000}) {
            BrokerProcess restarted = brokerWithLease("restart-" + leaseMillis,
                    leaseMillis);
            for (int attempt = 1; attempt <= 2; attempt++) {
                long start = System.nanoTime();
                BrokerProcess.Reply warm = restarted.warm(HARNESS);
                long elapsed = millis(start);
                RuntimeBindingRecord now = rig.bindings.findById(
                        before.getBindingId());
                log(probe, "lease " + leaseMillis + " ms, warm #" + attempt
                        + " -> " + warm.code() + " retryable="
                        + warm.retryable() + " after " + elapsed
                        + " ms (x" + String.format("%.2f",
                                elapsed / (double) leaseMillis)
                        + " lease); binding " + now.getState()
                        + "; workers=" + restarted.workers().size());
                assertEquals("runtime_broker_reconcile_timeout",
                        warm.code());
                assertEquals(RuntimeBindingRecord.State.READY,
                        now.getState());
            }
            restarted.close();
            extraBrokers.remove(restarted);
        }
        assertTrue(exited);
        assertEquals(RuntimeBindingRecord.State.READY, afterClose.getState());
    }

    /**
     * P4: what a merged (old) Broker does with a row a future Broker marked
     * ABANDONED. Pins fail closed because they are SQL literals; every row
     * read fails because the state is parsed with Enum.valueOf.
     */
    @Test
    void p4AnOldBrokerMeetsAnAbandonedRow() throws Exception {
        String probe = "p4-abandoned-row";
        BrokerProcess broker = rig.broker("broker", rig.proxy(),
                FaultGateRig.Provisioner.LOCAL_PROCESS);
        acquire(broker, SESSION);
        String execution = broker.create(HARNESS, SESSION, "key-1",
                FaultGateRig.shell("call-1", "echo ran >> marker")).object()
                .getString("executionCallId");
        ToolExecutionRecord settled = rig.awaitExecution(execution,
                ToolExecutionRecord::isSettled, "settled");
        log(probe, "execution " + execution + " " + settled.getState());
        try (Connection connection = dataSource().getConnection();
                PreparedStatement update = connection.prepareStatement(
                        "UPDATE qwen_tool_execution SET execution_state ="
                                + " 'ABANDONED' WHERE execution_call_id"
                                + " = ?")) {
            update.setString(1, execution);
            log(probe, "UPDATE execution_state='ABANDONED' rows="
                    + update.executeUpdate()
                    + " (VARCHAR(32), no CHECK constraint)");
        }
        record(probe, "get", broker.get(HARNESS, SESSION, execution));
        record(probe, "reconcile",
                broker.reconcile(HARNESS, SESSION, execution));
        record(probe, "cancel", broker.cancel(HARNESS, SESSION, execution));
        record(probe, "create same key", broker.create(HARNESS, SESSION,
                "key-1", FaultGateRig.shell("call-1",
                        "echo ran >> marker")));
        record(probe, "release", broker.release(HARNESS, SESSION));
        try {
            rig.execution(execution);
            log(probe, "repository read -> ok");
        } catch (RuntimeException failure) {
            log(probe, "repository read -> " + failure.getClass().getName()
                    + ": " + failure.getMessage());
        }
        log(probe, "marker=" + rig.marker("marker"));
        assertEquals(List.of("ran"), rig.marker("marker"));
    }

    private void record(String probe, String op, BrokerProcess.Reply reply) {
        log(probe, op + " -> ok=" + reply.ok() + (reply.ok()
                ? " " + JSON.toJSONString(reply.value())
                : " status=" + reply.status() + " code=" + reply.code()
                        + " message=" + reply.message()));
    }

    private BrokerProcess brokerWithLease(String name, long leaseMillis)
            throws Exception {
        Path template;
        try (var files = Files.list(rig.root)) {
            template = files.filter(path -> path.getFileName().toString()
                    .startsWith("first-") && path.toString()
                    .endsWith(".json")).findFirst().orElseThrow();
        }
        JSONObject config = JSON.parseObject(Files.readString(template));
        config.put("ownerId", name + "-" + System.nanoTime());
        config.put("operationLeaseMillis", leaseMillis);
        Path file = rig.root.resolve(name + ".json");
        Files.writeString(file, config.toJSONString());
        BrokerProcess broker = BrokerProcess.start(name, file,
                rig.root.resolve(name + ".log"), rig.root.resolve("home"));
        extraBrokers.add(broker);
        return broker;
    }

    private DataSource dataSource() throws Exception {
        Field field = FaultGateRig.class.getDeclaredField("dataSource");
        field.setAccessible(true);
        return (DataSource) field.get(rig);
    }

    private void acquire(BrokerProcess broker, String session) {
        assertEquals("READY", broker.warm(HARNESS).object()
                .getString("state"), rig.logs());
        broker.acquire(HARNESS, session).requireOk();
    }

    private long awaitEscapedPid() throws InterruptedException {
        Path file = rig.workspace.resolve("escaped.pid");
        String text = FaultGateRig.await(() -> {
            try {
                return Files.exists(file) ? Files.readString(file).trim()
                        : "";
            } catch (IOException exception) {
                return "";
            }
        }, value -> !value.isEmpty(), "escaped.pid");
        long pid = Long.parseLong(text);
        escapedPids.add(pid);
        return pid;
    }

    private List<Long> escaped() {
        return rig.marker("escaped").stream()
                .map(line -> Long.parseLong(line.substring(4).trim()))
                .toList();
    }

    private static String parent(long pid) {
        Optional<ProcessHandle> handle = ProcessHandle.of(pid);
        return handle.flatMap(ProcessHandle::parent)
                .map(p -> Long.toString(p.pid())).orElse("?");
    }

    private static long millis(long startNanos) {
        return (System.nanoTime() - startNanos) / 1_000_000;
    }

    private static synchronized void log(String probe, String line) {
        String text = System.currentTimeMillis() + " " + line + "\n";
        System.err.print("[" + probe + "] " + text);
        try {
            Files.writeString(OUT.resolve(probe + ".log"), text,
                    StandardCharsets.UTF_8, StandardOpenOption.CREATE,
                    StandardOpenOption.APPEND);
        } catch (IOException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
