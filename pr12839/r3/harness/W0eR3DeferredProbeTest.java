package com.alibaba.qwen.code.runtimebroker;

import static com.alibaba.qwen.code.runtimebroker.FaultGateRig.HARNESS;
import static com.alibaba.qwen.code.runtimebroker.FaultGateRig.SESSION;
import static com.alibaba.qwen.code.runtimebroker.W0eR3ProbeTest.describe;
import static com.alibaba.qwen.code.runtimebroker.W0eR3ProbeTest.log;

import com.alibaba.fastjson2.JSONObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * C2 (implementation head only; needs the local prepare/start rig ops): a
 * deferred call (#12831 prepareExecution/startExecution) reserved before a
 * loss, then started by the stale Broker after another Broker commits LOST.
 */
@Tag("fault-gate")
class W0eR3DeferredProbeTest {
    private FaultGateRig rig;

    @BeforeEach
    void open() throws Exception {
        Files.createDirectories(Path.of(System.getenv().getOrDefault(
                "W0E_OUT", System.getProperty("java.io.tmpdir"))));
        rig = FaultGateRig.open();
    }

    @AfterEach
    void close() throws Exception {
        rig.close();
    }

    @Test
    void c2StaleBrokerStartsADeferredCallAfterLoss() throws Exception {
        String probe = "c2-deferred-start";
        BrokerProcess first = rig.broker("first", rig.proxy(),
                FaultGateRig.Provisioner.RECOVERABLE);
        log(probe, "first warm -> " + describe(first.warm(HARNESS)));
        first.acquire(HARNESS, SESSION).requireOk();
        String payload = "{\"toolName\":\"run_shell_command\",\"input\":"
                + "{\"command\":\"echo deferred >> marker\","
                + "\"is_background\":false}}";
        String digest = "sha256:" + HexFormat.of().formatHex(MessageDigest
                .getInstance("SHA-256").digest(payload.getBytes(
                        StandardCharsets.UTF_8)));
        Map<String, Object> reference = new LinkedHashMap<>();
        reference.put("sessionId", SESSION);
        reference.put("promptId", "prompt-1");
        reference.put("callId", "call-d");
        reference.put("argsDigest", digest);
        BrokerProcess.Reply prepared = first.prepare(HARNESS, SESSION,
                "key-d", reference);
        log(probe, "first prepare key-d -> " + describe(prepared));
        String id = ((JSONObject) prepared.value()).getString(
                "executionCallId");
        // Keep the generation busy with a running call so the loss has an
        // in-flight record as well.
        first.create(HARNESS, SESSION, "key-1", FaultGateRig.shell("call-1",
                "echo start >> marker; sleep 20")).requireOk();
        rig.awaitMarker("marker", List.of("start"));
        List<ProcessHandle> workers = first.workers();
        first.pause();
        workers.forEach(w -> ProcessTrees.kill(w, FaultGateRig.WAIT));
        BrokerProcess second = rig.broker("second", rig.proxy(),
                FaultGateRig.Provisioner.RECOVERABLE);
        log(probe, "second warm -> " + describe(second.warm(HARNESS)));
        log(probe, "deferred key-d now " + rig.execution(id).getState());
        first.resume();
        log(probe, "first (stale) start key-d -> " + describe(first.start(
                HARNESS, SESSION, id, payload)));
        log(probe, "first (stale) prepare key-d retry -> " + describe(
                first.prepare(HARNESS, SESSION, "key-d", reference)));
        log(probe, "first (stale) get key-d -> " + describe(first.get(
                HARNESS, SESSION, id)));
        Thread.sleep(1_500);
        log(probe, "deferred key-d final " + rig.execution(id).getState()
                + "; marker " + rig.marker("marker"));
    }
}
