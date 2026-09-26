package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.qwen.code.runtimebroker.managedworkspace.ContextBinding;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;

/** Two bindings serve one scope (two storage IDs); runs on 735b7fda and 5e443797. */
public final class TwoStorage {
    public static void main(String[] args) throws Exception {
        String arm = args[0];
        DataSource source = Rig.ds(args[1]);
        JdbcRuntimeBrokerSchema.initialize(source);
        JdbcRuntimeBindingRepository bindings = new JdbcRuntimeBindingRepository(source, Rig.PROTECTOR);
        RuntimeScope scope = Rig.scope("workspace-a", "workspace", Rig.ROOT);
        HttpRuntimeTransport transport = new HttpRuntimeTransport();
        List<String> command = List.of("/bin/sh", Rig.RIG.resolve("worker.sh").toString(), "real");
        LocalProcessRuntimeProvisioner p1 = new LocalProcessRuntimeProvisioner(command, Rig.RIG,
                transport, ignored -> "storage:one");
        LocalProcessRuntimeProvisioner p2 = new LocalProcessRuntimeProvisioner(command, Rig.RIG,
                transport, ignored -> "storage:two");
        RuntimeBrokerService s1 = Rig.service(scope, p1, transport, bindings, "broker-one", Duration.ofSeconds(5));
        RuntimeBrokerService s2 = Rig.service(scope, p2, transport, bindings, "broker-two", Duration.ofSeconds(5));
        RuntimeBindingRecord one = s1.warm("harness").toCompletableFuture().get(40, TimeUnit.SECONDS);
        RuntimeBindingRecord two = s2.warm("harness").toCompletableFuture().get(40, TimeUnit.SECONDS);
        Rig.say(arm, "binding one " + one.getBindingId().substring(0, 8) + "… storage="
                + one.getRequest().getStorageId() + " | binding two " + two.getBindingId().substring(0, 8)
                + "… storage=" + two.getRequest().getStorageId() + " | same scope="
                + one.getRequest().getScope().equals(two.getRequest().getScope()));
        RuntimeSession session = new RuntimeSession("harness", "sess-one", "bootstrap", scope);
        RuntimeSessionRecord acquiredOnOne = new RuntimeSessionRecord(session, one.getBindingId(),
                one.getGeneration(), RuntimeSessionRecord.State.READY, 0, Instant.now());
        ContextBinding onTwo = new ContextBinding("tenant-a", "workspace-a", 7, "storage:two",
                "服务/api", "config:a", 1);
        Method install;
        Object sessionArgument;
        try {
            install = HttpRuntimeTransport.class.getMethod("installContext", RuntimeBindingRecord.class,
                    RuntimeSessionRecord.class, String.class, ContextBinding.class);
            sessionArgument = acquiredOnOne;
        } catch (NoSuchMethodException old) {
            install = HttpRuntimeTransport.class.getMethod("installContext", RuntimeBindingRecord.class,
                    RuntimeSession.class, String.class, ContextBinding.class);
            sessionArgument = session;
        }
        Rig.say(arm, "installContext signature: (RuntimeBindingRecord, "
                + install.getParameterTypes()[1].getSimpleName() + ", String, ContextBinding)");
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> receipt = ((CompletionStage<Map<String, Object>>) install.invoke(
                    transport, two, sessionArgument, "op-cross", onTwo)).toCompletableFuture()
                    .get(10, TimeUnit.SECONDS);
            Rig.say(arm, "Session acquired on binding one, installed on binding two -> receipt from "
                    + String.valueOf(receipt.get("runtimeInstanceId")).substring(0, 8) + "… (binding two's Runtime)");
            Map<String, Object> result = transport.execute(two.getLease(), session,
                    Rig.reference("sess-one", "call-cross", "pwd")).toCompletableFuture()
                    .get(30, TimeUnit.SECONDS);
            Rig.say(arm, "binding two's Runtime now runs sess-one -> " + Rig.text(result));
        } catch (InvocationTargetException refused) {
            Rig.say(arm, "Session acquired on binding one, installed on binding two -> refused before sending: "
                    + Rig.describe(refused.getCause()));
        }
        if (sessionArgument instanceof RuntimeSessionRecord) {
            RuntimeSessionRecord acquiredOnTwo = new RuntimeSessionRecord(
                    new RuntimeSession("harness", "sess-two", "bootstrap", scope), two.getBindingId(),
                    two.getGeneration(), RuntimeSessionRecord.State.READY, 0, Instant.now());
            @SuppressWarnings("unchecked")
            Map<String, Object> receipt = ((CompletionStage<Map<String, Object>>) install.invoke(
                    transport, two, acquiredOnTwo, "op-own", onTwo)).toCompletableFuture()
                    .get(10, TimeUnit.SECONDS);
            Rig.say(arm, "control: Session acquired on binding two -> receipt for " + receipt.get("sessionId"));
        }
        s1.close();
        s2.close();
        p1.close();
        p2.close();
        Runtime.getRuntime().halt(0);
    }
}
