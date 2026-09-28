package com.alibaba.qwen.code.runtimebroker;

import static com.alibaba.qwen.code.runtimebroker.FaultGateRig.HARNESS;
import static com.alibaba.qwen.code.runtimebroker.FaultGateRig.SESSION;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Round-3 probes for PR 12839 (log-only; compile on the design-only head and
 * on the implementation head). A4: transient attestation fault while a
 * managed-context placement starts. A5: a hung-but-alive worker.
 */
@Tag("fault-gate")
class W0eR3ProbeTest {
    private static final Path OUT = Path.of(System.getenv()
            .getOrDefault("W0E_OUT", System.getProperty("java.io.tmpdir")));
    private final List<AutoCloseable> extras = new ArrayList<>();

    @AfterEach
    void close() throws Exception {
        for (int i = extras.size() - 1; i >= 0; i--) {
            try {
                extras.get(i).close();
            } catch (Exception ignored) {
                // best effort
            }
        }
    }

    /** A4: managed-context (W0c-3) placements, one per Hosted Session. */
    @Test
    void a4TransientFaultWhileAManagedPlacementStarts() throws Exception {
        String probe = "a4-managed-startup";
        Files.createDirectories(OUT);
        FaultGateRig rig = FaultGateRig.open(FaultGateRig.Placement.MANAGED);
        extras.add(rig);
        FaultProxy proxy = rig.proxy();
        BrokerProcess a = rig.broker("a", proxy,
                FaultGateRig.Provisioner.LOCAL_PROCESS);
        warm(probe, "harness-1 warm (setup)", a, "harness-1");
        proxy.schedule("attest", FaultProxy.Action.RESET);
        log(probe, "inject: next attest exchange reset once");
        warm(probe, "harness-2 warm (first start, fault)", a, "harness-2");
        warm(probe, "harness-2 warm again (no fault)", a, "harness-2");
        warm(probe, "harness-3 warm (new Session, same Workspace)", a,
                "harness-3");
        warm(probe, "harness-1 warm (existing placement)", a, "harness-1");
        log(probe, "bindings: " + bindings(rig));
    }

    /** A5: the worker is alive but stopped (SIGSTOP), then resumed. */
    @Test
    void a5HungButAliveWorker() throws Exception {
        String probe = "a5-hung-worker";
        Files.createDirectories(OUT);
        FaultGateRig rig = FaultGateRig.open();
        extras.add(rig);
        BrokerProcess a = rig.broker("a", rig.proxy(),
                FaultGateRig.Provisioner.LOCAL_PROCESS);
        warm(probe, "warm (setup)", a, HARNESS);
        a.acquire(HARNESS, SESSION).requireOk();
        ProcessHandle worker = a.workers().get(0);
        String bindingId = rig.activeBinding().getBindingId();
        ProcessTrees.signal(worker.pid(), "STOP");
        log(probe, "SIGSTOP worker " + worker.pid());
        warm(probe, "warm #1 (worker stopped)", a, HARNESS);
        log(probe, "  binding " + rig.bindings.findById(bindingId).getState()
                + "; worker alive=" + worker.isAlive());
        warm(probe, "warm #2 (worker stopped)", a, HARNESS);
        log(probe, "  binding " + rig.bindings.findById(bindingId).getState());
        ProcessTrees.signal(worker.pid(), "CONT");
        log(probe, "SIGCONT worker " + worker.pid());
        warm(probe, "warm #3 (worker resumed)", a, HARNESS);
        log(probe, "  binding " + rig.bindings.findById(bindingId).getState()
                + "; worker alive=" + worker.isAlive());
        BrokerProcess.Reply create = a.create(HARNESS, SESSION, "key-1",
                FaultGateRig.shell("call-1", "echo after >> marker"));
        log(probe, "create -> " + describe(create));
        if (create.ok()) {
            String id = ((JSONObject) create.value()).getString(
                    "executionCallId");
            FaultGateRig.await(() -> rig.execution(id).getState().name(),
                    s -> s.equals("SETTLED") || s.equals("UNKNOWN")
                            || s.equals("ABANDONED"), "call-1 finished");
            log(probe, "call-1 " + rig.execution(id).getState() + " "
                    + rig.execution(id).getExecutionStatus() + "; marker "
                    + rig.marker("marker"));
        }
    }

    private static String bindings(FaultGateRig rig) throws Exception {
        Field field = FaultGateRig.class.getDeclaredField("dataSource");
        field.setAccessible(true);
        List<String> rows = new ArrayList<>();
        try (Connection c = ((DataSource) field.get(rig)).getConnection();
                Statement s = c.createStatement();
                ResultSet r = s.executeQuery("SELECT isolation_key,"
                        + " runtime_generation, binding_state FROM"
                        + " qwen_runtime_binding ORDER BY isolation_key,"
                        + " runtime_generation")) {
            while (r.next()) {
                rows.add(r.getString(1) + "/gen" + r.getLong(2) + "/"
                        + r.getString(3));
            }
        }
        return rows.toString();
    }

    private static BrokerProcess.Reply warm(String probe, String what,
            BrokerProcess broker, String harness) {
        long start = System.nanoTime();
        BrokerProcess.Reply reply = broker.warm(harness);
        log(probe, what + " -> " + describe(reply) + " ("
                + (System.nanoTime() - start) / 1_000_000 + " ms)");
        return reply;
    }

    static String describe(BrokerProcess.Reply reply) {
        if (reply.ok()) {
            if (reply.value() instanceof JSONObject object) {
                JSONObject copy = new JSONObject(object);
                for (String key : List.of("bindingId", "executionCallId")) {
                    if (copy.containsKey(key)) {
                        String v = copy.getString(key);
                        copy.put(key, v.substring(0, Math.min(8, v.length())));
                    }
                }
                copy.remove("dispatchOwner");
                copy.remove("record");
                copy.remove("result");
                return "ok " + copy.toJSONString();
            }
            return "ok " + JSON.toJSONString(reply.value());
        }
        return reply.status() + " " + reply.code() + " retryable="
                + reply.retryable();
    }

    static synchronized void log(String probe, String line) {
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
