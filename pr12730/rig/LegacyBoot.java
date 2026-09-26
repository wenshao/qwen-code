package com.alibaba.qwen.code.runtimebroker;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/** Uses only API present on main, so the same class runs on main and head. */
public final class LegacyBoot {
    public static void main(String[] args) throws Exception {
        Path rig = Path.of(System.getenv("RIG"));
        RuntimeScope scope = new RuntimeScope("tenant-a", "workspace-a", "7",
                System.getenv("ROOT"), "sha256:" + "c".repeat(64), "workspace");
        HttpRuntimeTransport transport = new HttpRuntimeTransport();
        LocalProcessRuntimeProvisioner provisioner = new LocalProcessRuntimeProvisioner(
                List.of("/bin/sh", rig.resolve("worker.sh").toString(), "real"), rig, transport);
        RuntimeBrokerService service = new RuntimeBrokerService(
                ignored -> CompletableFuture.completedFuture(scope), provisioner, transport,
                new InMemoryRuntimeBindingRepository(), new InMemoryRuntimeSessionRepository(),
                new InMemoryToolExecutionRepository(), "broker-legacy", Duration.ofSeconds(5),
                Duration.ofSeconds(5));
        RuntimeBindingRecord record = service.warm("harness").toCompletableFuture()
                .get(40, TimeUnit.SECONDS);
        System.out.println(args[0] + " legacy warm -> " + record.getState() + " attestGen="
                + record.getAttestationGeneration());
        service.close();
        provisioner.close();
        Runtime.getRuntime().halt(0);
    }
}
