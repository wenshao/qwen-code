package com.alibaba.qwen.code.runtimebroker;

import static com.alibaba.qwen.code.runtimebroker.FaultGateRig.HARNESS;
import static com.alibaba.qwen.code.runtimebroker.FaultGateRig.SESSION;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/** PR #12865 verification probes. They log what happens; they do not assert the verdict. */
@Tag("fault-gate")
class PR12865ProbeTest {
    private static final long T0 = System.nanoTime();

    static void log(String line) {
        String out = System.getenv("PROBE_OUT");
        String text = String.format("%7d %s%n", (System.nanoTime() - T0) / 1_000_000, line);
        System.out.print(text);
        if (out != null) {
            try {
                Files.writeString(Path.of(out), text, StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            } catch (Exception ignored) {
                // best effort
            }
        }
    }

    static String procState(long pid) {
        try {
            String stat = Files.readString(Path.of("/proc", Long.toString(pid), "stat"));
            String[] fields = stat.substring(stat.lastIndexOf(')') + 1).strip().split("\\s+");
            return "state=" + fields[0] + " ppid=" + fields[1] + " starttime=" + fields[19];
        } catch (java.nio.file.NoSuchFileException gone) {
            return "stat=absent";
        } catch (Exception other) {
            return "stat=" + other;
        }
    }

    static String bindingLine(FaultGateRig rig) {
        RuntimeBindingRecord b = rig.activeBinding();
        return "binding id=" + b.getBindingId() + " gen=" + b.getGeneration() + " state=" + b.getState()
                + " lease=" + (b.getLease() == null ? "null" : b.getLease().getEndpoint())
                + " lossEvidence=" + (b.getLossEvidence() == null ? "null" : b.getLossEvidence().fact())
                + " stopEvidence=" + (b.getStopEvidence() == null ? "null" : "present");
    }

    static void dumpDurable(FaultGateRig rig, String label) throws Exception {
        Path dir = rig.root.resolve("durable");
        log(label + " durable dir mode=" + PosixFilePermissions.toString(Files.getPosixFilePermissions(dir)));
        try (var files = Files.list(dir)) {
            for (Path path : files.sorted().toList()) {
                String name = path.getFileName().toString();
                String shortName = name.length() > 20 ? name.substring(0, 12) + "…" + name.substring(name.lastIndexOf('.')) : name;
                log(label + "   " + shortName + " mode=" + PosixFilePermissions.toString(Files.getPosixFilePermissions(path))
                        + " size=" + Files.size(path));
                if (name.endsWith(".json")) {
                    var record = JsonCodec.parseObject(Files.readAllBytes(path), "probe");
                            log(label + "     state=" + record.get("state") + " pid=" + record.get("pid") + " started=" + record.get("started")
                            + " endpoint=" + record.get("endpoint"));
                    log(label + "     handle=" + record.get("handle"));
                }
            }
        }
    }

    static void awaitExit(ProcessHandle worker) {
        try {
            worker.onExit().get(5, TimeUnit.SECONDS);
        } catch (Exception timeout) {
            log("   worker " + worker.pid() + " still reported alive after SIGKILL: " + procState(worker.pid()));
        }
    }

    static void timedWarm(BrokerProcess broker, String label) {
        long start = System.nanoTime();
        var reply = broker.warm(HARNESS);
        log(label + " warm -> ok=" + reply.ok() + " status=" + reply.status() + " code=" + reply.code()
                + " retryable=" + reply.retryable() + " in " + (System.nanoTime() - start) / 1_000_000 + " ms");
    }

    /** R1: identity and records written on this host; worker cwd. */
    @ParameterizedTest
    @EnumSource(FaultGateRig.Placement.class)
    void r1RecordsOnThisHost(FaultGateRig.Placement placement) throws Exception {
        try (var rig = FaultGateRig.open(placement)) {
            log("R1 " + placement + " os.name=" + System.getProperty("os.name")
                    + " machine-id=" + Files.readString(Path.of("/etc/machine-id")).strip()
                    + " boot_id=" + Files.readString(Path.of("/proc/sys/kernel/random/boot_id")).strip()
                    + " " + Files.readSymbolicLink(Path.of("/proc/self/ns/pid"))
                    + " " + Files.readSymbolicLink(Path.of("/proc/self/ns/time")));
            var first = rig.broker("first", rig.proxy(), FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            first.acquire(HARNESS, SESSION).requireOk();
            var worker = first.workers().getFirst();
            log("R1 " + placement + " worker pid=" + worker.pid() + " " + procState(worker.pid())
                    + " cwd=" + Files.readSymbolicLink(Path.of("/proc", Long.toString(worker.pid()), "cwd"))
                    + " stdout=" + Files.readSymbolicLink(Path.of("/proc", Long.toString(worker.pid()), "fd", "1")));
            dumpDurable(rig, "R1 " + placement);
            log("R1 " + placement + " " + bindingLine(rig));
            first.release(HARNESS, SESSION).requireOk();
        }
    }

    /** P1: the worker dies after REGISTERED but before READY is committed. */
    @ParameterizedTest
    @EnumSource(FaultGateRig.Placement.class)
    void p1WorkerDiesBeforeEndpointPublication(FaultGateRig.Placement placement) throws Exception {
        try (var rig = FaultGateRig.open(placement)) {
            var proxy = rig.proxy();
            var held = proxy.schedule("attest", FaultProxy.Action.HOLD_REQUEST);
            var first = rig.broker("first", proxy, FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            var pending = CompletableFuture.runAsync(() -> first.warm(HARNESS));
            held.awaitHeld(FaultGateRig.WAIT);
            var worker = first.workers().getFirst();
            log("P1 " + placement + " held attest; " + bindingLine(rig));
            rig.killBroker(first);
            held.release(FaultProxy.Action.RESET);
            pending.handle((ignored, failure) -> null).get(5, TimeUnit.SECONDS);
            worker.destroyForcibly();
            awaitExit(worker);
            Thread.sleep(300);
            log("P1 " + placement + " broker SIGKILL, worker SIGKILL pid=" + worker.pid() + " " + procState(worker.pid()));
            Thread.sleep(2500); // let the dead Broker operation claim (2 s lease) expire
            var second = rig.broker("second", rig.proxy(), FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            for (int i = 1; i <= 4; i++) {
                timedWarm(second, "P1 " + placement + " attempt " + i);
                log("P1 " + placement + "   " + bindingLine(rig) + " newWorkers=" + second.workers().size());
            }
            dumpDurable(rig, "P1 " + placement);
        }
    }

    /** P1b: same as P1 but the Broker stays alive; only the booting worker dies. */
    @ParameterizedTest
    @EnumSource(FaultGateRig.Placement.class)
    void p1bWorkerDiesDuringBootUnderLiveBroker(FaultGateRig.Placement placement) throws Exception {
        try (var rig = FaultGateRig.open(placement)) {
            var proxy = rig.proxy();
            var held = proxy.schedule("attest", FaultProxy.Action.HOLD_REQUEST);
            var first = rig.broker("first", proxy, FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            var pending = CompletableFuture.supplyAsync(() -> first.warm(HARNESS));
            held.awaitHeld(FaultGateRig.WAIT);
            var worker = first.workers().getFirst();
            worker.destroyForcibly();
            awaitExit(worker);
            held.release(FaultProxy.Action.RESET);
            var reply = pending.get(100, TimeUnit.SECONDS);
            log("P1b " + placement + " first warm -> status=" + reply.status() + " code=" + reply.code()
                    + " retryable=" + reply.retryable());
            log("P1b " + placement + "   " + bindingLine(rig));
            for (int i = 2; i <= 4; i++) {
                timedWarm(first, "P1b " + placement + " attempt " + i);
                log("P1b " + placement + "   " + bindingLine(rig) + " liveWorkers=" + first.workers().size());
            }
        }
    }

    /** Control for P1: the worker dies after READY (the PR's absent-worker gate shape, logged). */
    @ParameterizedTest
    @EnumSource(FaultGateRig.Placement.class)
    void c1WorkerDiesAfterReady(FaultGateRig.Placement placement) throws Exception {
        try (var rig = FaultGateRig.open(placement)) {
            var first = rig.broker("first", rig.proxy(), FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            first.acquire(HARNESS, SESSION).requireOk();
            var worker = first.workers().getFirst();
            rig.killBroker(first);
            worker.destroyForcibly();
            awaitExit(worker);
            Thread.sleep(300);
            log("C1 " + placement + " broker SIGKILL, then worker SIGKILL pid=" + worker.pid() + " " + procState(worker.pid()));
            var second = rig.broker("second", rig.proxy(), FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            for (int i = 1; i <= 2; i++) {
                timedWarm(second, "C1 " + placement + " attempt " + i);
                log("C1 " + placement + "   " + bindingLine(rig) + " newWorkers=" + second.workers().size());
            }
        }
    }

    /** P1c: P1b under the default ephemeral provisioner (control). */
    @ParameterizedTest
    @EnumSource(FaultGateRig.Placement.class)
    void p1cEphemeralControl(FaultGateRig.Placement placement) throws Exception {
        try (var rig = FaultGateRig.open(placement)) {
            var proxy = rig.proxy();
            var held = proxy.schedule("attest", FaultProxy.Action.HOLD_REQUEST);
            var first = rig.broker("first", proxy, FaultGateRig.Provisioner.LOCAL_PROCESS);
            var pending = CompletableFuture.supplyAsync(() -> first.warm(HARNESS));
            held.awaitHeld(FaultGateRig.WAIT);
            var worker = first.workers().getFirst();
            worker.destroyForcibly();
            awaitExit(worker);
            held.release(FaultProxy.Action.RESET);
            var reply = pending.get(100, TimeUnit.SECONDS);
            log("P1c " + placement + " first warm -> status=" + reply.status() + " code=" + reply.code()
                    + " retryable=" + reply.retryable());
            log("P1c " + placement + "   " + bindingLine(rig));
            for (int i = 2; i <= 4; i++) {
                timedWarm(first, "P1c " + placement + " attempt " + i);
                log("P1c " + placement + "   " + bindingLine(rig) + " liveWorkers=" + first.workers().size());
            }
        }
    }

    /** P3: a misconfigured worker command (exits at boot), then the operator fixes it and restarts. */
    @ParameterizedTest
    @EnumSource(FaultGateRig.Placement.class)
    void p3MisconfiguredWorkerThenFixed(FaultGateRig.Placement placement) throws Exception {
        for (var mode : new FaultGateRig.Provisioner[] {FaultGateRig.Provisioner.LOCAL_PROCESS,
                FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS}) {
            try (var rig = FaultGateRig.open(placement)) {
                String tag = "P3 " + placement + " " + (mode == FaultGateRig.Provisioner.LOCAL_PROCESS ? "ephemeral" : "durable");
                var proxy = rig.proxy();
                var template = rig.broker("template", proxy, mode);
                rig.closeBroker(template);
                Path templateConfig = rig.root.resolve("template-0.json");
                var config = new java.util.LinkedHashMap<String, Object>(JsonCodec.parseObject(Files.readAllBytes(templateConfig), "template"));
                config.put("node", "/bin/false");
                config.put("ownerId", "bad-" + java.util.UUID.randomUUID());
                Path badConfig = rig.root.resolve("bad-x.json");
                Files.write(badConfig, JsonCodec.encode(config));
                var bad = BrokerProcess.start("bad", badConfig, rig.root.resolve("bad-x.log"), rig.root.resolve("home"));
                for (int i = 1; i <= 2; i++) {
                    timedWarm(bad, tag + " misconfigured attempt " + i);
                    log(tag + "   " + bindingLine(rig));
                    Thread.sleep(2500);
                }
                bad.close();
                Thread.sleep(2500);
                var fixed = rig.broker("fixed", proxy, mode);
                for (int i = 1; i <= 3; i++) {
                    timedWarm(fixed, tag + " fixed attempt " + i);
                    log(tag + "   " + bindingLine(rig) + " liveWorkers=" + fixed.workers().size());
                    Thread.sleep(2500);
                }
                if (mode == FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS) {
                    dumpDurable(rig, tag);
                }
            }
        }
    }

    /** P3b: the node executable path is wrong, so ProcessBuilder.start() throws and nothing is spawned. */
    @ParameterizedTest
    @EnumSource(FaultGateRig.Placement.class)
    void p3bSpawnFailureThenFixed(FaultGateRig.Placement placement) throws Exception {
        try (var rig = FaultGateRig.open(placement)) {
            String tag = "P3b " + placement + " durable";
            var proxy = rig.proxy();
            var template = rig.broker("template", proxy, FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            rig.closeBroker(template);
            var config = new java.util.LinkedHashMap<String, Object>(JsonCodec.parseObject(
                    Files.readAllBytes(rig.root.resolve("template-0.json")), "template"));
            config.put("node", "/nonexistent/node");
            config.put("ownerId", "bad-" + java.util.UUID.randomUUID());
            Path badConfig = rig.root.resolve("bad-x.json");
            Files.write(badConfig, JsonCodec.encode(config));
            var bad = BrokerProcess.start("bad", badConfig, rig.root.resolve("bad-x.log"), rig.root.resolve("home"));
            timedWarm(bad, tag + " spawn-failure attempt 1");
            log(tag + "   " + bindingLine(rig));
            dumpDurable(rig, tag + " after spawn failure");
            bad.close();
            Thread.sleep(2500);
            var fixed = rig.broker("fixed", proxy, FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            for (int i = 1; i <= 2; i++) {
                timedWarm(fixed, tag + " fixed attempt " + i);
                log(tag + "   " + bindingLine(rig) + " liveWorkers=" + fixed.workers().size());
                Thread.sleep(2500);
            }
        }
    }

    /** T1 (R2): an adopted worker meets one transient attest reset during confirm (base 9e42875b1 retry path). */
    @ParameterizedTest
    @EnumSource(FaultGateRig.Placement.class)
    void t1AdoptedWorkerTransientConfirmFailure(FaultGateRig.Placement placement) throws Exception {
        try (var rig = FaultGateRig.open(placement)) {
            var first = rig.broker("first", rig.proxy(), FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            first.acquire(HARNESS, SESSION).requireOk();
            var worker = first.workers().getFirst();
            rig.killBroker(first);
            var proxy = rig.proxy();
            var second = rig.broker("second", proxy, FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            timedWarm(second, "T1 " + placement + " adopt");
            log("T1 " + placement + "   " + bindingLine(rig));
            proxy.schedule("attest", FaultProxy.Action.RESET);
            timedWarm(second, "T1 " + placement + " confirm with attest RESET");
            log("T1 " + placement + "   " + bindingLine(rig) + " workerAlive=" + worker.isAlive());
            timedWarm(second, "T1 " + placement + " next warm");
            log("T1 " + placement + "   " + bindingLine(rig) + " workerAlive=" + worker.isAlive()
                    + " newWorkers=" + second.workers().size());
        }
    }

    /** Z2 (R2): the adopted worker dies under the live adopting Broker. */
    @ParameterizedTest
    @EnumSource(FaultGateRig.Placement.class)
    void z2AdoptedWorkerDiesUnderLiveBroker(FaultGateRig.Placement placement) throws Exception {
        try (var rig = FaultGateRig.open(placement)) {
            var first = rig.broker("first", rig.proxy(), FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            first.acquire(HARNESS, SESSION).requireOk();
            var worker = first.workers().getFirst();
            rig.killBroker(first);
            var second = rig.broker("second", rig.proxy(), FaultGateRig.Provisioner.DURABLE_LOCAL_PROCESS);
            timedWarm(second, "Z2 " + placement + " adopt");
            worker.destroyForcibly();
            awaitExit(worker);
            Thread.sleep(300);
            log("Z2 " + placement + " adopted worker SIGKILL pid=" + worker.pid() + " " + procState(worker.pid()));
            for (int i = 1; i <= 3; i++) {
                timedWarm(second, "Z2 " + placement + " attempt " + i);
                log("Z2 " + placement + "   " + bindingLine(rig) + " newWorkers=" + second.workers().size());
            }
        }
    }
}
