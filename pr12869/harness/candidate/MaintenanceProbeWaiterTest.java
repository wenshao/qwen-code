package com.alibaba.qwen.code.runtimebroker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/** A request that runs into the maintenance observation of a healthy binding must still be served. */
class MaintenanceProbeWaiterTest {
    private static final RuntimeScope SCOPE = new RuntimeScope("tenant", "workspace", "1", "/workspace",
            "capability", "workspace");
    private static final RuntimeResourceHandle HANDLE = new RuntimeResourceHandle("local-process", 2,
            Map.of("resourceId", "runtime-resource"));

    @Test
    void aHealthyBindingStaysUsableWhileMaintenanceObservesIt() throws Exception {
        var bindings = new InMemoryRuntimeBindingRepository();
        var sessions = new InMemoryRuntimeSessionRepository();
        var executions = new InMemoryToolExecutionRepository();
        var attestations = new AtomicInteger();
        var gate = new AtomicReference<CompletableFuture<Void>>(CompletableFuture.completedFuture(null));
        RuntimeProvisioner provisioner = new RuntimeProvisioner() {
            @Override
            public String kind() { return "local-process"; }
            @Override
            public CompletionStage<RuntimeLease> provision(RuntimeProvisionRequest request) {
                throw new AssertionError("legacy provision must not be used");
            }
            @Override
            public CompletionStage<RuntimeResourceHandle> ensureResource(RuntimeProvisionRequest request,
                    RuntimeProvisionSeed seed, RuntimeResourceHandle known) {
                return CompletableFuture.completedFuture(HANDLE);
            }
            @Override
            public CompletionStage<RuntimeLease> provision(RuntimeProvisionRequest request, RuntimeProvisionSeed seed) {
                return CompletableFuture.completedFuture(new RuntimeLease(seed.getProvisionalRuntimeId(),
                        URI.create("http://127.0.0.1:4190"), seed.getToken(), seed.getLeaseId(), seed.getEpoch()));
            }
            @Override
            public CompletionStage<RuntimeObservation> reconcile(RuntimeProvisionRequest request,
                    RuntimeProvisionSeed seed, RuntimeResourceHandle handle, RuntimeLease lastLease) {
                return CompletableFuture.completedFuture(RuntimeObservation.ready(HANDLE,
                        URI.create("http://127.0.0.1:4190"), seed.getProvisionalRuntimeId(), seed.getLeaseId(),
                        seed.getEpoch()));
            }
            @Override
            public boolean supportsStartupRecovery(RuntimeResourceHandle handle) { return true; }
            @Override
            public CompletionStage<Void> release(RuntimeProvisionRequest request, RuntimeLease lease) {
                return CompletableFuture.completedFuture(null);
            }
        };
        RuntimeTransport transport = new RuntimeTransport() {
            @Override
            public CompletionStage<RuntimeAttestation> attest(RuntimeLease lease, RuntimeProvisionRequest request,
                    RuntimeProvisionSeed seed) {
                attestations.incrementAndGet();
                return gate.get().thenApply(ignored -> new RuntimeAttestation(lease.getRuntimeInstanceId(),
                        seed.getGatewayIncarnation(), lease.getLeaseId(), lease.getEpoch(), request.getScope(),
                        seed.getProvisionRequestId()));
            }
            @Override
            public CompletionStage<Void> acquire(RuntimeLease lease, RuntimeSession session) {
                return CompletableFuture.completedFuture(null);
            }
            @Override
            public CompletionStage<Object> control(RuntimeLease lease, RuntimeSession session,
                    Map<String, Object> operation) {
                return CompletableFuture.completedFuture(operation);
            }
            @Override
            public CompletionStage<Map<String, Object>> execute(RuntimeLease lease, RuntimeSession session,
                    Map<String, Object> reference) {
                return CompletableFuture.completedFuture(Map.of());
            }
            @Override
            public CompletionStage<Map<String, Object>> cancel(RuntimeLease lease, RuntimeSession session,
                    Map<String, Object> reference) {
                return CompletableFuture.completedFuture(Map.of());
            }
            @Override
            public CompletionStage<Boolean> release(RuntimeLease lease, RuntimeSession session) {
                return CompletableFuture.completedFuture(true);
            }
        };
        try (var service = new RuntimeBrokerService(ignored -> CompletableFuture.completedFuture(SCOPE), provisioner,
                transport, bindings, sessions, executions, "broker", Duration.ofSeconds(5), Duration.ofSeconds(5))) {
            RuntimeBindingRecord ready = service.warm("harness").toCompletableFuture().get(2, TimeUnit.SECONDS);
            assertEquals(RuntimeBindingRecord.State.READY, ready.getState());
            int before = attestations.get();

            // The scheduled scan observes the healthy binding; its attestation is still on the wire.
            var parked = new CompletableFuture<Void>();
            gate.set(parked);
            var probe = service.recoverBinding(ready.getBindingId(), ready.getGeneration()).toCompletableFuture();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (attestations.get() == before && System.nanoTime() < deadline) {
                Thread.sleep(5);
            }
            assertTrue(attestations.get() > before, "the maintenance observation must reach attestation");

            // A healthy turn arrives inside that window.
            var warm = service.warm("harness").toCompletableFuture();
            var acquire = service.acquire("harness", "runtime-session", "bootstrap").toCompletableFuture();
            assertFalse(warm.isDone());
            assertFalse(acquire.isDone());

            gate.set(CompletableFuture.completedFuture(null));
            parked.complete(null);
            assertEquals(RuntimeBindingRecord.State.READY, probe.get(2, TimeUnit.SECONDS).getState());
            assertEquals(RuntimeBindingRecord.State.READY, warm.get(2, TimeUnit.SECONDS).getState());
            assertEquals(RuntimeSessionRecord.State.READY, acquire.get(2, TimeUnit.SECONDS).getState());
        }
    }
}
