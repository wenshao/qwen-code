package com.alibaba.qwen.code.runtimebroker;

import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

public class BadWorkerE2E {
    static int pass = 0, fail = 0;
    static void check(String n, boolean ok, String d) { System.out.println((ok ? "PASS " : "FAIL ") + n + " :: " + d); if (ok) pass++; else fail++; }
    static String sh(String c) throws Exception { return RealWorkerE2E.sh(c); }
    static int count(String pat) throws Exception { String o = sh("pgrep -fc '[" + pat.charAt(0) + "]" + pat.substring(1) + "' || true"); return o.isEmpty() ? 0 : Integer.parseInt(o); }

    public static void main(String[] a) throws Exception {
        String cli = a[0], w = Path.of("workers").toAbsolutePath().toString();
        HttpRuntimeTransport t = new HttpRuntimeTransport();
        Path wd = Path.of("").toAbsolutePath();

        // B1 silent worker: 30 s ready deadline, process destroyed, binding FAILED -> next warm re-provisions
        try (var p = new LocalProcessRuntimeProvisioner(List.of("node", w + "/silent.mjs"), wd, t)) {
            var svc = RealWorkerE2E.service(p, "s");
            long t0 = System.nanoTime();
            Throwable e = RealWorkerE2E.warmError(svc, "h");
            long ms = (System.nanoTime() - t0) / 1_000_000;
            Thread.sleep(300);
            check("B1 silent worker times out and is killed", e != null && count("silent.mjs") == 0,
                    RealWorkerE2E.describe(e) + " after " + ms + "ms; left=" + count("silent.mjs"));
            svc.close();
        }
        // B2 real worker behind a ready record with another leaseId
        try (var p = new LocalProcessRuntimeProvisioner(List.of("node", w + "/wrong-lease.mjs", cli), wd, t)) {
            var svc = RealWorkerE2E.service(p, "l");
            Throwable e = RealWorkerE2E.warmError(svc, "h");
            Thread.sleep(800);
            check("B2 lying ready record rejected, wrapper + real worker gone", e != null && count("wrong-lease.mjs") == 0,
                    RealWorkerE2E.describe(e) + " msg=" + (e.getCause() == null ? "" : e.getCause().getMessage())
                    + "; wrapper left=" + count("wrong-lease.mjs"));
            svc.close();
        }
        // B3 attest 409 and ignores SIGTERM
        int before = count("deaf-409.mjs");
        try (var p = new LocalProcessRuntimeProvisioner(List.of("node", w + "/deaf-409.mjs"), wd, t)) {
            var svc = RealWorkerE2E.service(p, "d");
            Throwable e = RealWorkerE2E.warmError(svc, "h");
            Thread.sleep(6500);
            int left = count("deaf-409.mjs") - before;
            check("B3 attestation 409 -> worker process ended", e != null && left == 0,
                    RealWorkerE2E.describe(e) + "; processes still alive after failure+6.5s=" + left);
            Throwable e2 = RealWorkerE2E.warmError(svc, "h");
            Thread.sleep(500);
            System.out.println("INFO B3 second warm re-provisions: " + RealWorkerE2E.describe(e2) + "; alive=" + (count("deaf-409.mjs") - before));
            svc.close();
        }
        sh("pkill -9 -f '[d]eaf-409.mjs'");
        // B4 non-loopback url
        String host = sh("hostname -I | awk '{print $1}'");
        Path cap = Files.createTempFile(wd, "cap", ".json");
        try (var p = new LocalProcessRuntimeProvisioner(List.of("node", w + "/remote-url.mjs", host, cap.toString()), wd, t)) {
            var svc = RealWorkerE2E.service(p, "r");
            Throwable e = RealWorkerE2E.warmError(svc, "h");
            String got = Files.readString(cap);
            check("B4 non-loopback ready url is refused before sending credentials", got.isEmpty(),
                    "warm=" + RealWorkerE2E.describe(e) + " captured at " + host + ": " + got);
            svc.close();
        }
        Files.deleteIfExists(cap);
        System.out.println("TOTAL pass=" + pass + " fail=" + fail);
        System.exit(0);
    }
}
