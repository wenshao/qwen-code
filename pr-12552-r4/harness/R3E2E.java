package com.alibaba.qwen.code.runtimebroker;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

/**
 * Round 3: drives the PR provisioner + service (head 9d08c65a) against the
 * real `qwen managed-runtime-worker` and a few misbehaving doubles, on macOS.
 * Usage: R3E2E <cli.js> <workers dir> <fixture.mjs> [scenario...]
 */
public class R3E2E {
    static final String DIGEST = "sha256:" + "a".repeat(64);
    static int pass = 0, fail = 0;
    static String cli, workers, fixture;
    static final HttpRuntimeTransport T = new HttpRuntimeTransport();
    static final Path WD = Path.of("").toAbsolutePath();

    static RuntimeScope scopeFor(String h) {
        return new RuntimeScope("tenant-a", "ws-" + h, "7", "/runtime/" + h, DIGEST, "workspace");
    }

    static void check(String name, boolean ok, String detail) {
        System.out.println((ok ? "PASS " : "FAIL ") + name + " :: " + detail);
        if (ok) pass++; else fail++;
    }

    static void info(String s) { System.out.println("INFO " + s); }

    static String sh(String cmd) throws Exception {
        Process p = new ProcessBuilder("bash", "-c", cmd).redirectErrorStream(true).start();
        String out = new String(p.getInputStream().readAllBytes()).trim();
        p.waitFor();
        return out;
    }

    static String pidOnPort(int port) throws Exception {
        return sh("lsof -nP -iTCP:" + port + " -sTCP:LISTEN -t | head -1");
    }

    static String listenAddr(int port) throws Exception {
        return sh("lsof -nP -iTCP:" + port + " -sTCP:LISTEN | awk 'NR>1{print $9}' | head -1");
    }

    static boolean alive(String pid) throws Exception {
        return !pid.isEmpty() && sh("kill -0 " + pid + " 2>/dev/null; echo $?").equals("0");
    }

    /** Count processes whose command line contains this (unique scratchpad) path. */
    static int count(String needle) throws Exception {
        String o = sh("pgrep -f '" + needle + "' | wc -l | tr -d ' '");
        return o.isEmpty() ? 0 : Integer.parseInt(o);
    }

    static int realWorkers() throws Exception { return count(cli + " managed-runtime-worker"); }

    static RuntimeBrokerService service(RuntimeProvisioner provisioner, String prefix, RuntimeTransport transport) {
        int[] n = {0};
        return new RuntimeBrokerService(
                h -> CompletableFuture.completedFuture(scopeFor(h)), provisioner, transport,
                new InMemoryRuntimeBindingRepository(Clock.systemUTC(), () -> prefix + (++n[0])),
                new InMemoryRuntimeSessionRepository(),
                new InMemoryToolExecutionRepository(Clock.systemUTC()),
                "broker", Duration.ofMinutes(1), Duration.ofMinutes(1));
    }

    static <X> Object outcome(CompletionStage<X> stage) {
        try {
            X v = stage.toCompletableFuture().get(70, TimeUnit.SECONDS);
            return v;
        } catch (ExecutionException e) {
            return e.getCause();
        } catch (Exception e) {
            return e;
        }
    }

    static String describe(Object o) {
        if (o instanceof RuntimeBrokerException r) {
            return r.getStatusCode() + " " + r.getCode() + " retryable=" + r.isRetryable();
        }
        if (o instanceof RuntimeBindingRecord b) return "OK gen=" + b.getGeneration() + " port=" + b.getLease().getEndpoint().getPort();
        if (o instanceof RuntimeSessionRecord s) return "OK session " + s.getState();
        if (o instanceof ToolExecutionRecord x) return "OK execution " + x.getState();
        if (o instanceof Throwable t) return t.toString();
        return "OK " + o;
    }

    static LocalProcessRuntimeProvisioner real() {
        return new LocalProcessRuntimeProvisioner(List.of("node", cli, "managed-runtime-worker"), WD, T);
    }

    public static void main(String[] args) throws Exception {
        cli = args[0];
        workers = args[1];
        fixture = args[2];
        Set<String> only = new HashSet<>(Arrays.asList(args).subList(3, args.length));
        int base = realWorkers();
        info("real workers before start=" + base);
        if (only.isEmpty() || only.contains("A")) scenarioA();
        if (only.isEmpty() || only.contains("B")) scenarioB();
        if (only.isEmpty() || only.contains("C")) scenarioC();
        if (only.isEmpty() || only.contains("D")) scenarioD();
        if (only.isEmpty() || only.contains("E")) scenarioE();
        if (only.isEmpty() || only.contains("F")) scenarioF();
        if (only.isEmpty() || only.contains("G")) scenarioG();
        if (only.contains("H")) scenarioH();
        if (only.isEmpty() || only.contains("I")) scenarioI();
        Thread.sleep(800);
        check("Z no real workers left after every service.close()", realWorkers() == base,
                "workers=" + (realWorkers() - base));
        System.out.println("TOTAL pass=" + pass + " fail=" + fail);
        System.exit(0);
    }

    /** A: adoption, re-attest cost, stop / kill -9 then recovery (round-1 F1). */
    static void scenarioA() throws Exception {
        RuntimeBrokerService svc = service(real(), "a", new Accepting());
        long t0 = System.nanoTime();
        RuntimeBindingRecord ready = svc.warm("h1").toCompletableFuture().get(70, TimeUnit.SECONDS);
        long ms = (System.nanoTime() - t0) / 1_000_000;
        int port = ready.getLease().getEndpoint().getPort();
        String pid = pidOnPort(port);
        check("A1 warm adopts real worker", ready.getState() == RuntimeBindingRecord.State.READY,
                "gen=" + ready.getGeneration() + " endpoint=" + ready.getLease().getEndpoint() + " pid=" + pid + " cold=" + ms + "ms listen=" + listenAddr(port));
        long[] us = new long[20];
        for (int i = 0; i < us.length; i++) {
            long s = System.nanoTime();
            svc.warm("h1").toCompletableFuture().get(10, TimeUnit.SECONDS);
            us[i] = (System.nanoTime() - s) / 1_000;
        }
        Arrays.sort(us);
        info("A2 20 warms on READY (each re-attests over HTTP) p50=" + us[10] / 1000.0 + "ms p95=" + us[18] / 1000.0 + "ms");

        // stop -> warm x6
        int before = realWorkers();
        sh("kill -TERM " + pid);
        Thread.sleep(500);
        List<String> seq = new ArrayList<>();
        for (int i = 0; i < 6; i++) seq.add(describe(outcome(svc.warm("h1"))));
        int spawned = realWorkers() - before + 1;
        check("A3 after SIGTERM of the worker, the binding recovers (round-1 F1)",
                seq.get(0).startsWith("503") && seq.subList(1, 6).stream().allMatch(s -> s.startsWith("OK")),
                "6 warms => " + seq + "; fresh workers=" + spawned);

        // kill -9 -> warm x6
        RuntimeBindingRecord cur = svc.warm("h1").toCompletableFuture().get(10, TimeUnit.SECONDS);
        String pid2 = pidOnPort(cur.getLease().getEndpoint().getPort());
        sh("kill -9 " + pid2);
        Thread.sleep(300);
        seq.clear();
        for (int i = 0; i < 6; i++) seq.add(describe(outcome(svc.warm("h1"))));
        check("A4 after kill -9 of the worker, the binding recovers",
                seq.get(0).startsWith("503") && seq.subList(1, 6).stream().allMatch(s -> s.startsWith("OK")),
                "6 warms => " + seq);
        int live = realWorkers();
        svc.close();
        Thread.sleep(600);
        check("A5 service.close() now ends the provisioner's workers (R1-33)", realWorkers() == live - 1,
                "real workers before close=" + live + " after=" + realWorkers());
    }

    /** B: a session acquired before the worker died. */
    static void scenarioB() throws Exception {
        RuntimeBrokerService svc = service(real(), "b", new Accepting());
        RuntimeSessionRecord s1 = svc.acquire("h2", "rt-1", "bootstrap").toCompletableFuture().get(70, TimeUnit.SECONDS);
        svc.acquire("h2", "rt-9", "bootstrap").toCompletableFuture().get(70, TimeUnit.SECONDS);
        RuntimeBindingRecord b1 = svc.warm("h2").toCompletableFuture().get(10, TimeUnit.SECONDS);
        String pid = pidOnPort(b1.getLease().getEndpoint().getPort());
        info("B0 acquired rt-1 state=" + s1.getState() + " on gen=" + b1.getGeneration() + " pid=" + pid);
        sh("kill -9 " + pid);
        Thread.sleep(300);
        Map<String, Object> op = Map.of("kind", "checkpoint");
        List<String> ctl = new ArrayList<>();
        for (int i = 0; i < 3; i++) ctl.add(describe(outcome(svc.control("h2", "rt-1", op))));
        check("B1 control on a dead worker is refused before transport (R2-1)", ctl.stream().allMatch(s -> s.startsWith("503")), "3x control => " + ctl);
        Object ex = outcome(svc.createExecution("h2", "rt-9", "idem-1", Map.of("sessionId", "rt-9", "promptId", "p", "callId", "c", "argsDigest", "d")));
        Thread.sleep(500);
        Object ex2 = ex instanceof ToolExecutionRecord x ? outcome(svc.getExecution("h2", "rt-9", x.getExecutionCallId())) : ex;
        info("B2 createExecution (session rt-9) on dead worker => " + describe(ex) + "; later => " + describe(ex2));

        Object w = outcome(svc.warm("h2"));
        info("B3 warm(h2) after death => " + describe(w));
        List<String> after = new ArrayList<>();
        for (int i = 0; i < 3; i++) after.add(describe(outcome(svc.warm("h2"))));
        info("B3b next warms => " + after);

        Object reacq = outcome(svc.acquire("h2", "rt-1", "bootstrap"));
        Object reacqAfter = null;
        List<String> ctl2 = new ArrayList<>();
        for (int i = 0; i < 3; i++) ctl2.add(describe(outcome(svc.control("h2", "rt-1", op))));
        List<String> rel = new ArrayList<>();
        for (int i = 0; i < 3; i++) rel.add(describe(outcome(svc.release("h2", "rt-1"))));
        check("B4 the old session can still be released or re-acquired once the binding recovered",
                rel.stream().anyMatch(s -> s.startsWith("OK")) || ctl2.stream().anyMatch(s -> s.startsWith("OK")),
                "acquire(rt-1) => " + describe(reacq) + "; 3x control => " + ctl2 + "; 3x release => " + rel);
        reacqAfter = outcome(svc.acquire("h2", "rt-1", "bootstrap"));
        info("B4c acquire(rt-1) after those releases => " + describe(reacqAfter)
                + (reacqAfter instanceof RuntimeSessionRecord ? "; control => " + describe(outcome(svc.control("h2", "rt-1", op))) : ""));
        info("B4b release(rt-9, which holds the UNKNOWN execution) => " + describe(outcome(svc.release("h2", "rt-9"))));
        Object other = outcome(svc.acquire("h2", "rt-2", "bootstrap"));
        info("B5 a new runtimeSessionId on the same harness => " + describe(other)
                + (other instanceof RuntimeSessionRecord ? "; control => " + describe(outcome(svc.control("h2", "rt-2", op))) : ""));
        svc.close();
    }

    /** C: a live worker that stops attesting (409 on re-attest) - is it released? */
    static void scenarioC() throws Exception {
        String needle = workers + "/flaky-409.mjs";
        int base = count(needle);
        LocalProcessRuntimeProvisioner p = new LocalProcessRuntimeProvisioner(List.of("node", needle), WD, T);
        RuntimeBrokerService svc = service(p, "c", new Accepting());
        List<String> seq = new ArrayList<>();
        List<Integer> alive = new ArrayList<>();
        Set<Integer> ports = new LinkedHashSet<>();
        for (int i = 0; i < 8; i++) {
            Object o = outcome(svc.warm("h3"));
            seq.add(describe(o));
            if (o instanceof RuntimeBindingRecord b) ports.add(b.getLease().getEndpoint().getPort());
            Thread.sleep(300);
            alive.add(count(needle) - base);
        }
        List<String> listening = new ArrayList<>();
        for (int port : ports) listening.add(port + ":" + (pidOnPort(port).isEmpty() ? "closed" : "LISTEN"));
        check("C1 a retired worker that failed re-attestation is released",
                alive.get(alive.size() - 1) <= 1,
                "8 warms => " + seq + "; alive after each = " + alive + "; retired endpoints " + listening);
        svc.close();
        Thread.sleep(800);
        info("C2 after service.close(): alive=" + (count(needle) - base));
    }

    /** D: the hung real worker - SIGSTOP; re-attest times out; after SIGCONT is the old one still up? */
    static void scenarioD() throws Exception {
        RuntimeBrokerService svc = service(real(), "d", new Accepting());
        RuntimeBindingRecord b = svc.warm("h4").toCompletableFuture().get(70, TimeUnit.SECONDS);
        int port = b.getLease().getEndpoint().getPort();
        String pid = pidOnPort(port);
        sh("kill -STOP " + pid);
        long t0 = System.nanoTime();
        Object w = outcome(svc.warm("h4"));
        long ms = (System.nanoTime() - t0) / 1_000_000;
        sh("kill -CONT " + pid);
        Object w2 = outcome(svc.warm("h4"));
        Thread.sleep(500);
        check("D1 hung worker: re-attest times out, next warm re-provisions",
                String.valueOf(describe(w)).startsWith("503") && w2 instanceof RuntimeBindingRecord,
                "warm while stopped => " + describe(w) + " after " + ms + "ms; next warm => " + describe(w2));
        check("D2 the retired (hung, then resumed) worker is torn down",
                !alive(pid), "old pid " + pid + " alive=" + alive(pid) + " listen=" + listenAddr(port));
        svc.close();
        Thread.sleep(800);
        info("D3 after service.close(): old pid alive=" + alive(pid));
    }

    /** E: SIGTERM-ignoring workers (round-1 F2). */
    static void scenarioE() throws Exception {
        String deaf = workers + "/deaf-409.mjs";
        int b0 = count(deaf);
        RuntimeBrokerService svc = service(new LocalProcessRuntimeProvisioner(List.of("node", deaf), WD, T), "e", new Accepting());
        Object w = outcome(svc.warm("h5"));
        Thread.sleep(1500);
        check("E1 failed adoption of a SIGTERM-ignoring worker kills it (finally -> destroyForcibly)",
                count(deaf) - b0 == 0, "warm => " + describe(w) + "; alive after 1.5s=" + (count(deaf) - b0));
        svc.close();

        String stuck = workers + "/sigterm-deaf.mjs";
        int b1 = count(stuck);
        LocalProcessRuntimeProvisioner p = new LocalProcessRuntimeProvisioner(List.of("node", stuck, fixture), WD, T);
        RuntimeBrokerService svc2 = service(p, "f", new Accepting());
        Object ok = outcome(svc2.warm("h6"));
        int adopted = count(stuck) - b1;
        svc2.close();
        Thread.sleep(6500);
        check("E2 service.close() ends an adopted worker that ignores SIGTERM",
                count(stuck) - b1 == 0, "warm => " + describe(ok) + "; adopted=" + adopted + "; alive 6.5s after close=" + (count(stuck) - b1));
    }

    /** F: ready record with a non-loopback url (round-1 F3). */
    static void scenarioF() throws Exception {
        String host = sh("ipconfig getifaddr en0 || ipconfig getifaddr en1");
        Path cap = Files.createTempFile(WD, "cap", ".json");
        RuntimeBrokerService svc = service(new LocalProcessRuntimeProvisioner(
                List.of("node", workers + "/remote-url.mjs", host, cap.toString()), WD, T), "r", new Accepting());
        Object w = outcome(svc.warm("h7"));
        String got = Files.readString(cap);
        check("F1 non-loopback ready url is refused before credentials are sent", got.isEmpty(),
                "warm=" + describe(w) + " captured at " + host + ": " + got);
        svc.close();
        Files.deleteIfExists(cap);
    }

    /** G: a stale session released after the binding recovered must not disturb the new generation. */
    static void scenarioG() throws Exception {
        RuntimeBrokerService svc = service(real(), "g", new Accepting());
        svc.acquire("h8", "rt-1", "bootstrap").toCompletableFuture().get(70, TimeUnit.SECONDS);
        RuntimeBindingRecord b1 = svc.warm("h8").toCompletableFuture().get(10, TimeUnit.SECONDS);
        String pid1 = pidOnPort(b1.getLease().getEndpoint().getPort());
        sh("kill -9 " + pid1);
        Thread.sleep(300);
        Object r0 = outcome(svc.warm("h8"));
        RuntimeBindingRecord b2 = svc.warm("h8").toCompletableFuture().get(70, TimeUnit.SECONDS);
        int port2 = b2.getLease().getEndpoint().getPort();
        String pid2 = pidOnPort(port2);
        svc.acquire("h8", "rt-2", "bootstrap").toCompletableFuture().get(70, TimeUnit.SECONDS);
        int w0 = realWorkers();
        Map<String, Object> op = Map.of("kind", "checkpoint");
        String rel = describe(outcome(svc.release("h8", "rt-1")));
        String ctlOld = describe(outcome(svc.control("h8", "rt-1", op)));
        String ctl = describe(outcome(svc.control("h8", "rt-2", op)));
        Object b3 = outcome(svc.warm("h8"));
        String rel2 = describe(outcome(svc.release("h8", "rt-2")));
        boolean same = b3 instanceof RuntimeBindingRecord r && r.getBindingId().equals(b2.getBindingId())
                && r.getLease().getEndpoint().getPort() == port2;
        check("G1 releasing a stale session after recovery leaves the new generation alone",
                rel.startsWith("OK") && ctl.startsWith("OK") && same && alive(pid2) && realWorkers() == w0,
                "warm after kill => " + describe(r0) + "; gen2 " + b2.getBindingId() + " pid " + pid2
                + "; release(rt-1 on dead gen1) => " + rel + "; control(rt-1) => " + ctlOld
                + "; control(rt-2 on gen2) => " + ctl + "; warm => " + describe(b3)
                + (b3 instanceof RuntimeBindingRecord r ? " id=" + r.getBindingId() : "")
                + "; gen2 pid alive=" + alive(pid2) + "; workers " + w0 + "->" + realWorkers()
                + "; release(rt-2) => " + rel2);
        svc.close();
    }

    /** H: how long the fixture double takes from spawn to attested, vs the 33 ms first renewal tick. */
    static void scenarioH() throws Exception {
        RuntimeScope scope = scopeFor("h9");
        List<Long> ms = new ArrayList<>();
        try (LocalProcessRuntimeProvisioner p = new LocalProcessRuntimeProvisioner(List.of("node", fixture), WD, T)) {
            for (int i = 0; i < 40; i++) {
                RuntimeProvisionRequest req = new RuntimeProvisionRequest(scope, null);
                long t0 = System.nanoTime();
                RuntimeLease l = p.provision(req).toCompletableFuture().get(30, TimeUnit.SECONDS);
                ms.add((System.nanoTime() - t0) / 1_000_000);
                p.release(req, l).toCompletableFuture().get(10, TimeUnit.SECONDS);
            }
        }
        List<Long> sorted = new ArrayList<>(ms);
        Collections.sort(sorted);
        long under = ms.stream().filter(x -> x < 33).count();
        info("H1 fixture provision ms (spawn->attested) n=40 min=" + sorted.get(0) + " p50=" + sorted.get(20)
                + " max=" + sorted.get(39) + "; under 33 ms=" + under + "/40; all=" + ms);
    }

    /** I: cancel of an in-flight invocation (#12583 path, merged from main) meets the PR's liveness check. */
    static void scenarioI() throws Exception {
        Pending tr = new Pending();
        RuntimeBrokerService svc = service(real(), "i", tr);
        svc.acquire("h10", "rt-1", "bootstrap").toCompletableFuture().get(70, TimeUnit.SECONDS);
        RuntimeBindingRecord b1 = svc.warm("h10").toCompletableFuture().get(10, TimeUnit.SECONDS);
        String pid1 = pidOnPort(b1.getLease().getEndpoint().getPort());
        Map<String, Object> ref = Map.of("sessionId", "rt-1", "promptId", "p", "callId", "c", "argsDigest", "d");
        ToolExecutionRecord x = (ToolExecutionRecord) outcome(svc.createExecution("h10", "rt-1", "idem-i", ref));
        String id = x.getExecutionCallId();
        for (int i = 0; i < 50 && tr.executes.get() == 0; i++) Thread.sleep(20);
        String c1 = describe(outcome(svc.cancelExecution("h10", "rt-1", id)));
        int cancelsAlive = tr.cancels.get();
        sh("kill -9 " + pid1);
        Thread.sleep(300);
        String c2 = describe(outcome(svc.cancelExecution("h10", "rt-1", id)));
        int cancelsDead = tr.cancels.get() - cancelsAlive;
        tr.pending.completeExceptionally(new IllegalStateException("worker gone"));
        Thread.sleep(300);
        String after = describe(outcome(svc.getExecution("h10", "rt-1", id)));
        String c3 = describe(outcome(svc.cancelExecution("h10", "rt-1", id)));
        String rel = describe(outcome(svc.release("h10", "rt-1")));
        Object w = outcome(svc.warm("h10"));
        check("I1 cancel of an in-flight call: live worker gets the physical cancel, dead worker is refused before transport",
                cancelsAlive == 1 && c2.startsWith("503") && cancelsDead == 0 && w instanceof RuntimeBindingRecord r && r.getGeneration() == 2,
                "alive: cancel => " + c1 + " (transport.cancel x" + cancelsAlive + "); after kill -9: cancel => " + c2
                + " (transport.cancel x" + cancelsDead + "); execute fails => " + after + "; cancel again => " + c3
                + "; release => " + rel + "; warm => " + describe(w));
        svc.close();
    }

    static final class Pending implements RuntimeTransport {
        final java.util.concurrent.atomic.AtomicInteger executes = new java.util.concurrent.atomic.AtomicInteger();
        final java.util.concurrent.atomic.AtomicInteger cancels = new java.util.concurrent.atomic.AtomicInteger();
        final CompletableFuture<Map<String, Object>> pending = new CompletableFuture<>();
        public CompletionStage<Void> acquire(RuntimeLease l, RuntimeSession s) { return CompletableFuture.completedFuture(null); }
        public CompletionStage<Object> control(RuntimeLease l, RuntimeSession s, Map<String, Object> o) { return CompletableFuture.completedFuture("ok"); }
        public CompletionStage<Map<String, Object>> execute(RuntimeLease l, RuntimeSession s, Map<String, Object> r) { executes.incrementAndGet(); return pending; }
        public CompletionStage<Map<String, Object>> cancel(RuntimeLease l, RuntimeSession s, Map<String, Object> r) { cancels.incrementAndGet(); return CompletableFuture.completedFuture(Map.of("state", "requested")); }
        public CompletionStage<Boolean> release(RuntimeLease l, RuntimeSession s) { return CompletableFuture.completedFuture(true); }
    }

    static final class Accepting implements RuntimeTransport {
        public CompletionStage<Void> acquire(RuntimeLease l, RuntimeSession s) { return CompletableFuture.completedFuture(null); }
        public CompletionStage<Object> control(RuntimeLease l, RuntimeSession s, Map<String, Object> o) { return CompletableFuture.completedFuture("ok"); }
        public CompletionStage<Map<String, Object>> execute(RuntimeLease l, RuntimeSession s, Map<String, Object> r) { return CompletableFuture.completedFuture(Map.of("executionStatus", "success")); }
        public CompletionStage<Map<String, Object>> cancel(RuntimeLease l, RuntimeSession s, Map<String, Object> r) { return CompletableFuture.completedFuture(Map.of("state", "settled")); }
        public CompletionStage<Boolean> release(RuntimeLease l, RuntimeSession s) { return CompletableFuture.completedFuture(true); }
    }
}
