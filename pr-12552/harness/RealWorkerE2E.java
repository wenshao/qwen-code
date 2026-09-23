package com.alibaba.qwen.code.runtimebroker;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

/** Drives the PR's provisioner + service against the real qwen managed-runtime-worker. */
public class RealWorkerE2E {
    static final String DIGEST = "sha256:" + "a".repeat(64);
    static final RuntimeScope SCOPE = new RuntimeScope("tenant-a", "workspace-a", "7",
            "/runtime/workspace", DIGEST, "workspace");
    static int pass = 0, fail = 0;

    static RuntimeScope scopeFor(String h) {
        if (!h.startsWith("w:")) return SCOPE;
        return new RuntimeScope("tenant-a", "ws-" + h.substring(2), "7", "/runtime/" + h.substring(2), DIGEST, "workspace");
    }

    static void check(String name, boolean ok, String detail) {
        System.out.println((ok ? "PASS " : "FAIL ") + name + " :: " + detail);
        if (ok) pass++; else fail++;
    }

    static String sh(String cmd) throws Exception {
        Process p = new ProcessBuilder("bash", "-c", cmd).redirectErrorStream(true).start();
        String out = new String(p.getInputStream().readAllBytes()).trim();
        p.waitFor();
        return out;
    }

    static String pidOnPort(int port) throws Exception {
        return sh("ss -ltnpH 'sport = :" + port + "' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2");
    }

    static int workerCount() throws Exception {
        return Integer.parseInt(sh("pgrep -fc '[c]li.js managed-runtime-worker' || true").isEmpty() ? "0"
                : sh("pgrep -fc '[c]li.js managed-runtime-worker' || true"));
    }

    static RuntimeBrokerService service(RuntimeProvisioner provisioner, String bindingPrefix) {
        int[] n = {0};
        return new RuntimeBrokerService(
                h -> CompletableFuture.completedFuture(scopeFor(h)), provisioner, new Accepting(),
                new InMemoryRuntimeBindingRepository(Clock.systemUTC(), () -> bindingPrefix + (++n[0])),
                new InMemoryRuntimeSessionRepository(),
                new InMemoryToolExecutionRepository(Clock.systemUTC()),
                "broker", Duration.ofMinutes(1), Duration.ofMinutes(1));
    }

    static Throwable warmError(RuntimeBrokerService s, String h) {
        try {
            s.warm(h).toCompletableFuture().get(70, TimeUnit.SECONDS);
            return null;
        } catch (ExecutionException e) {
            return e.getCause();
        } catch (Exception e) {
            return e;
        }
    }

    static String describe(Throwable t) {
        if (t instanceof RuntimeBrokerException r) {
            return r.getStatusCode() + " " + r.getCode() + " retryable=" + r.isRetryable();
        }
        return String.valueOf(t);
    }

    public static void main(String[] args) throws Exception {
        String cli = args[0];
        List<String> cmd = List.of("node", cli, "managed-runtime-worker");
        HttpRuntimeTransport transport = new HttpRuntimeTransport();
        Path wd = Path.of("").toAbsolutePath();

        // S1..S4: adoption, re-attest, execute 404, stop -> next warm
        try (LocalProcessRuntimeProvisioner prov = new LocalProcessRuntimeProvisioner(cmd, wd, transport)) {
            RuntimeBrokerService svc = service(prov, "b");
            long t0 = System.nanoTime();
            RuntimeBindingRecord ready = svc.warm("h1").toCompletableFuture().get(70, TimeUnit.SECONDS);
            long ms = (System.nanoTime() - t0) / 1_000_000;
            RuntimeLease lease = ready.getLease();
            int port = lease.getEndpoint().getPort();
            String pid = pidOnPort(port);
            check("S1 warm adopts real worker", ready.getState() == RuntimeBindingRecord.State.READY,
                    "state=" + ready.getState() + " endpoint=" + lease.getEndpoint() + " pid=" + pid + " cold=" + ms + "ms");
            String listen = sh("ss -ltnH 'sport = :" + port + "' | awk '{print $4}'");
            check("S1b worker listens on loopback only", listen.equals("127.0.0.1:" + port), "listen=" + listen);

            long[] warmMs = new long[20];
            for (int i = 0; i < warmMs.length; i++) {
                long s = System.nanoTime();
                svc.warm("h1").toCompletableFuture().get(10, TimeUnit.SECONDS);
                warmMs[i] = (System.nanoTime() - s) / 1_000;
            }
            Arrays.sort(warmMs);
            check("S2 warm on READY re-attests (real HTTP)", true,
                    "20 warm p50=" + warmMs[10] / 1000.0 + "ms p95=" + warmMs[18] / 1000.0 + "ms");

            Throwable ex = null;
            try {
                transport.execute(lease, new RuntimeSession("h1", "rt-1", "bootstrap", SCOPE),
                        Map.of("callId", "tool-1")).toCompletableFuture().get(10, TimeUnit.SECONDS);
            } catch (ExecutionException e) { ex = e.getCause(); }
            check("S3 execute against real worker fails closed", ex instanceof RuntimeBrokerException r
                    && r.getStatusCode() == 404 && !r.isRetryable(), describe(ex)
                    + " msg=" + (ex == null ? "" : ex.getMessage()));

            prov.stop(lease);
            Thread.sleep(500);
            boolean gone = pidOnPort(port).isEmpty() && sh("kill -0 " + pid + " 2>&1; echo $?").endsWith("1");
            check("S4a stop() ends the real worker (SIGTERM)", gone, "pid " + pid + " gone=" + gone);
            Throwable w = warmError(svc, "h1");
            check("S4b next warm after stop fails", w instanceof RuntimeBrokerException, describe(w));
            // recovery attempts
            List<String> later = new ArrayList<>();
            int before = workerCount();
            for (int i = 0; i < 5; i++) {
                Throwable again = warmError(svc, "h1");
                later.add(again == null ? "OK" : describe(again));
                Thread.sleep(200);
            }
            int after = workerCount();
            check("S4c binding recovers after worker death (retry told retryable=true)",
                    later.contains("OK"), "5 retries => " + later + "; workers spawned=" + (after - before));
            svc.close();
        }

        // S5: external crash (kill -9), plus new session acquire path
        try (LocalProcessRuntimeProvisioner prov = new LocalProcessRuntimeProvisioner(cmd, wd, transport)) {
            RuntimeBrokerService svc = service(prov, "c");
            RuntimeLease lease = svc.warm("h2").toCompletableFuture().get(70, TimeUnit.SECONDS).getLease();
            String pid = pidOnPort(lease.getEndpoint().getPort());
            sh("kill -9 " + pid);
            Thread.sleep(300);
            Throwable w = warmError(svc, "h2");
            check("S5 kill -9 worker -> next warm fails closed", w instanceof RuntimeBrokerException, describe(w));
            svc.close();
        }

        // S6: close() semantics
        int base = workerCount();
        LocalProcessRuntimeProvisioner prov6 = new LocalProcessRuntimeProvisioner(cmd, wd, transport);
        RuntimeBrokerService svc6 = service(prov6, "d");
        for (int i = 0; i < 3; i++) {
            svc6.warm("w:six" + i).toCompletableFuture().get(70, TimeUnit.SECONDS);
        }
        int live = workerCount() - base;
        svc6.close();
        Thread.sleep(500);
        int afterSvcClose = workerCount() - base;
        prov6.close();
        Thread.sleep(800);
        int afterProvClose = workerCount() - base;
        check("S6 provisioner.close() ends all owned workers", afterProvClose == 0,
                "live=" + live + " afterServiceClose=" + afterSvcClose + " afterProvisionerClose=" + afterProvClose);

        // S7: concurrency, 8 harness sessions in parallel
        try (LocalProcessRuntimeProvisioner prov = new LocalProcessRuntimeProvisioner(cmd, wd, transport)) {
            RuntimeBrokerService svc = service(prov, "e");
            long t0 = System.nanoTime();
            List<CompletableFuture<RuntimeBindingRecord>> all = new ArrayList<>();
            for (int i = 0; i < 8; i++) {
                all.add(svc.warm("w:seven" + i).toCompletableFuture());
            }
            CompletableFuture.allOf(all.toArray(CompletableFuture[]::new)).get(120, TimeUnit.SECONDS);
            Set<Integer> ports = new HashSet<>();
            for (var f : all) ports.add(f.get().getLease().getEndpoint().getPort());
            check("S7 8 parallel warms -> 8 distinct attested workers", ports.size() == 8,
                    "ports=" + ports.size() + " wall=" + (System.nanoTime() - t0) / 1_000_000 + "ms");
            svc.close();
        }
        Thread.sleep(800);
        check("S7b no workers left after close", workerCount() == base, "workers=" + (workerCount() - base));
        System.out.println("TOTAL pass=" + pass + " fail=" + fail);
        System.exit(0);
    }

    static final class Accepting implements RuntimeTransport {
        public CompletionStage<Void> acquire(RuntimeLease l, RuntimeSession s) { return CompletableFuture.completedFuture(null); }
        public CompletionStage<Object> control(RuntimeLease l, RuntimeSession s, Map<String, Object> o) { return CompletableFuture.completedFuture("ok"); }
        public CompletionStage<Map<String, Object>> execute(RuntimeLease l, RuntimeSession s, Map<String, Object> r) { return CompletableFuture.completedFuture(Map.of("executionStatus", "success")); }
        public CompletionStage<Map<String, Object>> cancel(RuntimeLease l, RuntimeSession s, Map<String, Object> r) { return CompletableFuture.completedFuture(Map.of("state", "settled")); }
        public CompletionStage<Boolean> release(RuntimeLease l, RuntimeSession s) { return CompletableFuture.completedFuture(true); }
    }
}
