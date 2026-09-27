package com.alibaba.qwen.code.runtimebroker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.lang.reflect.Proxy;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Two properties of trusted reboot recovery that no existing test pins. */
class RebootRecoveryGapTest {
    @TempDir
    Path directory;

    @Test
    void anotherMachineIsNeverTreatedAsARebootOfTheOriginalHost() throws Exception {
        var original = DurableLocalProcessRuntimeProvisionerTest.HOST;
        var seed = RuntimeProvisionSeed.create("binding", 1);
        var request = new RuntimeProvisionRequest(new RuntimeScope("tenant", "workspace", "1",
                directory.toAbsolutePath().toString(), "sha256:" + "a".repeat(64), "workspace"),
                null, LocalProcessRuntimeProvisioner.KIND, "storage:a");
        var transport = new HttpRuntimeTransport();
        RuntimeResourceHandle handle;
        try (var first = new LocalProcessRuntimeProvisioner(List.of("must-not-run"), directory, transport,
                ignored -> "storage:a", new LocalRuntimeStore(directory.toRealPath(), original))) {
            handle = first.ensureResource(request, seed, null).toCompletableFuture().get(10, TimeUnit.SECONDS);
        }
        for (String boot : List.of("22222222-2222-2222-2222-222222222222", original.bootId())) {
            var foreign = new LocalRuntimeStore.HostIdentity("b".repeat(32), boot,
                    original.pidNamespace(), original.timeNamespace());
            try (var trusted = new LocalProcessRuntimeProvisioner(List.of("must-not-run"), directory, transport,
                    null, new LocalRuntimeStore(directory.toRealPath(), foreign), true)) {
                var observed = trusted.reconcile(request, seed, handle, null)
                        .toCompletableFuture().get(10, TimeUnit.SECONDS);
                assertNotEquals(RuntimeObservation.Outcome.NOT_FOUND, observed.getOutcome(), "boot " + boot);
                assertNull(observed.getLossEvidence(), "boot " + boot);
                assertNull(observed.getStopEvidence(), "boot " + boot);
            }
        }
        var untouched = new LocalRuntimeStore(directory.toRealPath(), original).locked(request, seed, handle, false,
                (resource, registration) -> registration);
        assertEquals(LocalRuntimeStore.State.INTENT, untouched.state());
    }

    @Test
    void aProvisionerWithoutACleanupCallbackCannotRetireAManagedGeneration() throws Exception {
        var bindings = new InMemoryRuntimeBindingRepository();
        var sessions = new InMemoryRuntimeSessionRepository();
        var executions = new InMemoryToolExecutionRepository();
        var fixture = new RuntimeMaintenanceRecoveryTest.Fixture(bindings, sessions, executions, "gap");
        var lost = fixture.lose();
        bindings.releaseOperation(lost.getBindingId(), "fixture", lost.getOperationGeneration());
        RuntimeProvisioner withoutCleanup = new RuntimeProvisioner() {
            @Override
            public String kind() { return "local-process"; }
            @Override
            public CompletionStage<RuntimeLease> provision(RuntimeProvisionRequest request) {
                throw new AssertionError("Maintenance cannot provision");
            }
            @Override
            public CompletionStage<RuntimeResourceHandle> ensureResource(RuntimeProvisionRequest request,
                    RuntimeProvisionSeed seed, RuntimeResourceHandle known) {
                throw new AssertionError("Maintenance cannot ensure resources");
            }
            @Override
            public boolean supportsStartupRecovery(RuntimeResourceHandle handle) { return true; }
        };
        RuntimeTransport transport = (RuntimeTransport) Proxy.newProxyInstance(RuntimeTransport.class.getClassLoader(),
                new Class<?>[] {RuntimeTransport.class}, (proxy, method, arguments) -> {
                    throw new AssertionError("Maintenance cannot call a dead worker: " + method);
                });
        try (var service = new RuntimeBrokerService(id -> {
            throw new AssertionError("Maintenance cannot resolve current grants");
        }, withoutCleanup, transport, bindings, sessions, executions, "maintenance",
                Duration.ofSeconds(5), Duration.ofSeconds(5))) {
            assertThrows(ExecutionException.class, () -> service.recoverBinding(lost.getBindingId(),
                    lost.getGeneration()).toCompletableFuture().get(5, TimeUnit.SECONDS));
            assertEquals(RuntimeBindingRecord.State.LOST, bindings.findById(lost.getBindingId()).getState());
            assertEquals(1, sessions.countActiveByBinding(lost.getBindingId(), lost.getGeneration()));
        }
    }
}
