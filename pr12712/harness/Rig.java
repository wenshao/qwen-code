package com.alibaba.qwen.code.runtimebroker;

import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

/**
 * Drives the real LocalProcessRuntimeProvisioner (current main) with a worker
 * command and prints what the Broker sees: a lease, or the exception's
 * status, code, retryable flag and message.
 */
public final class Rig {
    public static void main(String[] args) throws Exception {
        String label = args[0];
        Path workspace = Path.of(args[1]).toRealPath();
        List<String> command = List.of(args).subList(2, args.length);
        RuntimeScope scope = new RuntimeScope("tenant-a", "workspace-a", "7",
                workspace.toString(), "sha256:" + "a".repeat(64),
                "workspace");
        long started = System.nanoTime();
        try (LocalProcessRuntimeProvisioner provisioner =
                new LocalProcessRuntimeProvisioner(command, workspace,
                        new HttpRuntimeTransport())) {
            RuntimeLease lease = provisioner.provision(
                    new RuntimeProvisionRequest(scope, null))
                    .toCompletableFuture().get(60, TimeUnit.SECONDS);
            System.out.printf("%-22s LEASE endpoint=%s epoch=%d (%d ms)%n",
                    label, lease.getEndpoint(), lease.getEpoch(),
                    (System.nanoTime() - started) / 1_000_000);
        } catch (ExecutionException wrapped) {
            Throwable failure = wrapped.getCause();
            if (failure instanceof RuntimeBrokerException broker) {
                System.out.printf("%-22s %d %s retryable=%s message=\"%s\""
                        + " (%d ms)%n", label, broker.getStatusCode(),
                        broker.getCode(), broker.isRetryable(),
                        broker.getMessage(),
                        (System.nanoTime() - started) / 1_000_000);
            } else {
                System.out.printf("%-22s OTHER %s%n", label, failure);
            }
        }
    }

    private Rig() {
    }
}
