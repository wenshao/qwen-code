package com.alibaba.qwen.code.runtimebroker;

import static com.alibaba.qwen.code.runtimebroker.FaultGateRig.HARNESS;
import static com.alibaba.qwen.code.runtimebroker.FaultGateRig.SESSION;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * Verification rig for PR 12964 (not part of the PR). Real Broker JVMs with
 * the production durable local-process provisioner, a real worker and the
 * rig's SQL database; every step is written to a JSONL ledger so the same
 * probe can run on main and on main + PR.
 */
@Tag("fault-gate")
class G2ProbeFaultGateTest {
    private static final Path LEDGER = Path.of(System.getProperty("g2.out", "/tmp/g2probe.jsonl"));
    private static final String ARM = System.getProperty("g2.arm", "?");

    enum Scenario { FINISHED_AFTER_CRASH, STILL_RUNNING_AT_TAKEOVER, STATUS_UNAVAILABLE }

    @ParameterizedTest
    @EnumSource(Scenario.class)
    void probe(Scenario scenario) throws Exception {
        try (var rig = FaultGateRig.open(FaultGateRig.Placement.MANAGED)) {
            String marker = "project/marker";
            var proxyA = rig.proxy();
            FaultProxy.Fault held = scenario == Scenario.STATUS_UNAVAILABLE
                    ? proxyA.schedule("execute", FaultProxy.Action.HOLD_RESPONSE) : null;
            var a = rig.broker("a", proxyA, FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            a.acquire(HARNESS, SESSION).requireOk();
            String command = switch (scenario) {
                case FINISHED_AFTER_CRASH -> "echo start >> marker; sleep 2; echo end >> marker; echo out-finished";
                case STILL_RUNNING_AT_TAKEOVER -> "echo start >> marker; sleep 12; echo end >> marker; echo out-late";
                case STATUS_UNAVAILABLE -> "echo start >> marker; echo end >> marker; echo out-unavailable";
            };
            var reference = FaultGateRig.shell("call-1", command);
            String execution = a.create(HARNESS, SESSION, "key-1", reference).object().getString("executionCallId");
            if (held != null) {
                held.awaitHeld(FaultGateRig.WAIT);
                rig.awaitMarker(marker, List.of("start", "end"));
            } else {
                rig.awaitMarker(marker, List.of("start"));
            }
            long workerPid = a.workers().getFirst().pid();
            log(scenario, "A running", rig, execution, null, marker, Map.of("workerPid", workerPid));
            rig.killBroker(a);
            if (held != null) {
                held.release(FaultProxy.Action.RESET);
            }
            if (scenario == Scenario.FINISHED_AFTER_CRASH) {
                rig.awaitMarker(marker, List.of("start", "end"));
                Thread.sleep(500);
            }
            log(scenario, "A killed", rig, execution, null, marker, Map.of());

            var proxyB = rig.proxy();
            if (scenario == Scenario.STATUS_UNAVAILABLE) {
                proxyB.schedule("status", FaultProxy.Action.RESET);
            }
            var b = rig.broker("b", proxyB, FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            long t0 = System.nanoTime();
            var acquired = b.acquire(HARNESS, SESSION);
            log(scenario, "B acquire", rig, execution, proxyB, marker, Map.of(
                    "acquireOk", acquired.ok(), "acquireCode", String.valueOf(acquired.ok() ? "" : acquired.code()),
                    "acquireMs", (System.nanoTime() - t0) / 1_000_000,
                    "workerAlive", ProcessHandle.of(workerPid).map(ProcessHandle::isAlive).orElse(false)));
            if (scenario == Scenario.STILL_RUNNING_AT_TAKEOVER) {
                rig.awaitMarker(marker, List.of("start", "end"));
                Thread.sleep(500);
                log(scenario, "tool finished under B", rig, execution, proxyB, marker, Map.of(
                        "reconcile", b.reconcile(HARNESS, SESSION, execution).object().getString("outcome")));
            } else {
                rig.awaitDispatchLapse(execution);
            }
            var retried = b.create(HARNESS, SESSION, "key-1", reference);
            log(scenario, "B same-key retry", rig, execution, proxyB, marker, Map.of(
                    "retryState", retried.ok() ? retried.object().getString("state") : "error " + retried.code()));
            rig.killBroker(b);

            var proxyC = rig.proxy();
            var c = rig.broker("c", proxyC, FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            var third = c.acquire(HARNESS, SESSION);
            log(scenario, "C acquire", rig, execution, proxyC, marker, Map.of("acquireOk", third.ok()));
            var get = c.get(HARNESS, SESSION, execution);
            log(scenario, "C get", rig, execution, proxyC, marker, Map.of(
                    "getState", get.ok() ? get.object().getString("state") : "error " + get.code()));
            assertEquals(List.of("start", "end"), rig.marker(marker), "the tool ran exactly once");
            assertEquals(1, proxyA.count("execute"));
            assertEquals(0, proxyB.count("execute") + proxyC.count("execute"));
        }
    }

    private static void log(Scenario scenario, String step, FaultGateRig rig, String execution,
            FaultProxy proxy, String marker, Map<String, Object> extra) throws Exception {
        ToolExecutionRecord record = rig.execution(execution);
        Map<String, Object> line = new LinkedHashMap<>();
        line.put("arm", ARM);
        line.put("scenario", scenario.name());
        line.put("step", step);
        line.put("state", record.getState().name());
        line.put("version", record.getVersion());
        line.put("status", record.getExecutionStatus());
        line.put("output", record.getResult() == null ? null : record.getResult().get("output"));
        line.put("dispatchOwner", record.getDispatchOwner());
        line.put("dispatchGeneration", record.getDispatchGeneration());
        line.put("leaseUntil", String.valueOf(record.getDispatchLeaseUntil()));
        line.put("marker", rig.marker(marker));
        if (proxy != null) {
            line.put("status_calls", proxy.count("status"));
            line.put("execute_calls", proxy.count("execute"));
            line.put("attest_calls", proxy.count("attest"));
        }
        line.putAll(extra);
        Files.writeString(LEDGER, JSON.toJSONString(line) + "\n", StandardCharsets.UTF_8,
                StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    }
}
