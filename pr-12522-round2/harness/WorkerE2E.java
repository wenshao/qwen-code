package com.alibaba.qwen.code.runtimebroker;

import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.*;

/** Real `qwen managed-runtime-worker` (built bundle) driven by HttpRuntimeTransport. */
public final class WorkerE2E {
    static final String CLI = "/root/verify/pr12522/dist/cli.js";
    static final String DIGEST = "sha256:" + "a".repeat(64);
    static int pass, fail;

    record Id(String token, String rt, String inc, String lease, long epoch, String prov,
              String tenant, String ws, String gen, String cwd, String digest, String iso) {
        Id with(String f, Object v) {
            Map<String, Object> m = new LinkedHashMap<>(Map.of("token", token, "rt", rt, "inc", inc, "lease", lease,
                    "epoch", epoch, "prov", prov, "tenant", tenant, "ws", ws, "gen", gen, "cwd", cwd));
            m.put("digest", digest); m.put("iso", iso); m.put(f, v);
            return new Id((String) m.get("token"), (String) m.get("rt"), (String) m.get("inc"), (String) m.get("lease"),
                    ((Number) m.get("epoch")).longValue(), (String) m.get("prov"), (String) m.get("tenant"), (String) m.get("ws"),
                    (String) m.get("gen"), (String) m.get("cwd"), (String) m.get("digest"), (String) m.get("iso"));
        }
    }

    static final Id BOOT = new Id("fixture-token", "runtime-01", "boot-01", "lease-01", 4, "provision-01",
            "tenant-a", "workspace-a", "7", "/runtime/workspace", DIGEST, "session");

    public static void main(String[] args) throws Exception {
        String node = args.length > 0 ? args[0] : "node";
        System.out.println("java=" + System.getProperty("java.version") + " transport=" + HttpRuntimeTransport.class.getProtectionDomain().getCodeSource().getLocation().getPath().replaceAll(".*/verify/", ""));
        ProcessBuilder pb = new ProcessBuilder(node, CLI, "managed-runtime-worker");
        pb.redirectError(ProcessBuilder.Redirect.INHERIT);
        long t0 = System.nanoTime();
        Process worker = pb.start();
        String boot = String.format("{\"type\":\"boot\",\"version\":1,\"token\":\"%s\",\"runtimeInstanceId\":\"%s\",\"runtimeIncarnation\":\"%s\",\"leaseId\":\"%s\",\"epoch\":%d,\"provisionRequestId\":\"%s\",\"tenantId\":\"%s\",\"workspaceId\":\"%s\",\"workspaceGeneration\":\"%s\",\"workspaceCwd\":\"%s\",\"capabilityDigest\":\"%s\",\"isolationClass\":\"%s\"}",
                BOOT.token, BOOT.rt, BOOT.inc, BOOT.lease, BOOT.epoch, BOOT.prov, BOOT.tenant, BOOT.ws, BOOT.gen, BOOT.cwd, BOOT.digest, BOOT.iso);
        try (OutputStream in = worker.getOutputStream()) { in.write(boot.getBytes(StandardCharsets.UTF_8)); }
        String ready = new BufferedReader(new InputStreamReader(worker.getInputStream(), StandardCharsets.UTF_8)).readLine();
        System.out.printf("worker ready in %.0f ms: %s%n", (System.nanoTime() - t0) / 1e6, ready);
        String url = ready.replaceAll(".*\"url\":\"([^\"]+)\".*", "$1");
        HttpRuntimeTransport t = new HttpRuntimeTransport();

        check(t, url, "E01 exact identity", BOOT, BOOT, "ok", null);
        check(t, url, "E02 wrong token (lease+seed)", BOOT.with("token", "other-token"), BOOT.with("token", "other-token"), "401 managed_runtime_unauthorized retry=false", null);
        check(t, url, "E03 stale epoch 3", BOOT.with("epoch", 3L), BOOT.with("epoch", 3L), "409 managed_runtime_identity_conflict retry=false", null);
        check(t, url, "E04 other lease id", BOOT.with("lease", "lease-02"), BOOT.with("lease", "lease-02"), "409 managed_runtime_identity_conflict retry=false", null);
        check(t, url, "E05 other workspaceId", BOOT.with("ws", "workspace-b"), BOOT, "409 managed_runtime_identity_conflict retry=false", null);
        check(t, url, "E06 other workspaceGeneration", BOOT.with("gen", "8"), BOOT, "409 managed_runtime_identity_conflict retry=false", null);
        check(t, url, "E07 other tenant", BOOT.with("tenant", "tenant-b"), BOOT, "409 managed_runtime_identity_conflict retry=false", null);
        check(t, url, "E08 other cwd", BOOT.with("cwd", "/runtime/other"), BOOT, "409 managed_runtime_identity_conflict retry=false", null);
        check(t, url, "E09 other capabilityDigest", BOOT.with("digest", "sha256:" + "b".repeat(64)), BOOT, "409 managed_runtime_identity_conflict retry=false", null);
        check(t, url, "E10 isolationClass workspace", BOOT.with("iso", "workspace"), BOOT, "409 managed_runtime_identity_conflict retry=false", null);
        check(t, url, "E11 other provisionRequestId (seed)", BOOT, BOOT.with("prov", "provision-02"), "409 managed_runtime_identity_conflict retry=false", null);
        check(t, url, "E12 seed gatewayIncarnation != worker incarnation (client-side)", BOOT, BOOT.with("inc", "boot-02"), "409 managed_runtime_identity_conflict retry=false", null);
        check(t, url, "E13 lease runtimeInstanceId != worker (client-side)", BOOT.with("rt", "runtime-02"), BOOT, "409 managed_runtime_identity_conflict retry=false", null);
        check(t, url, "E15 malformed capabilityDigest", BOOT.with("digest", "sha256:zz"), BOOT, "400 managed_runtime_attestation_invalid retry=false", null);

        // keep-alive: worker keepAliveTimeout=1000ms; reuse the pooled connection around that boundary
        int[] gaps = {0, 500, 900, 950, 980, 990, 995, 1000, 1005, 1010, 1020, 1050, 1100, 1500};
        Map<String, Integer> outcomes = new TreeMap<>();
        int rounds = Integer.getInteger("rounds", 3);
        for (int r = 0; r < rounds; r++) for (int gap : gaps) {
            attestNow(t, url, BOOT, BOOT, null);
            Thread.sleep(gap);
            String o = attestNow(t, url, BOOT, BOOT, null);
            outcomes.merge("gap=" + gap + "ms " + o, 1, Integer::sum);
        }
        System.out.println("KEEPALIVE boundary (worker keepAliveTimeout=1000ms), " + rounds + " rounds per gap:");
        outcomes.forEach((k, v) -> System.out.println("   " + v + "x " + k));

        worker.destroy();
        int code = worker.waitFor();
        System.out.println("worker SIGTERM exit=" + code);
        check(t, url, "E16 worker gone (connection refused)", BOOT, BOOT, "503 managed_runtime_unavailable retry=true", null);
        System.out.println("SUMMARY pass=" + pass + " fail=" + fail);
        System.exit(fail == 0 ? 0 : 1);
    }

    static String attestNow(HttpRuntimeTransport t, String url, Id lease, Id seed, String endpoint) {
        RuntimeScope scope = new RuntimeScope(lease.tenant, lease.ws, lease.gen, lease.cwd, lease.digest, lease.iso);
        RuntimeLease l = new RuntimeLease(lease.rt, URI.create(endpoint != null ? endpoint : url + "/"), lease.token, lease.lease, lease.epoch);
        RuntimeProvisionSeed s = new RuntimeProvisionSeed(seed.prov, "provisional-01", seed.inc, lease.lease, lease.epoch, lease.token);
        RuntimeProvisionRequest req = new RuntimeProvisionRequest(scope, "session".equals(lease.iso) ? "session-key-1" : null);
        try {
            RuntimeAttestation a = t.attest(l, req, s).toCompletableFuture().get(40, TimeUnit.SECONDS);
            return "ok";
        } catch (ExecutionException e) {
            Throwable c = e.getCause();
            if (c instanceof RuntimeBrokerException r) return r.getStatusCode() + " " + r.getCode() + " retry=" + r.isRetryable();
            return "RAW " + c;
        } catch (Exception e) {
            return "HANG " + e;
        }
    }

    static void check(HttpRuntimeTransport t, String url, String name, Id lease, Id seed, String want, String endpoint) {
        String got = attestNow(t, url, lease, seed, endpoint);
        boolean ok = got.equals(want);
        if (ok) pass++; else fail++;
        System.out.printf("%s %-62s -> %s%s%n", ok ? "PASS" : "FAIL", name, got, ok ? "" : "   (want " + want + ")");
    }
}
