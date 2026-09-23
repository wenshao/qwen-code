package com.alibaba.qwen.code.runtimebroker;

import java.io.*;
import java.lang.management.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/**
 * Drives HttpRuntimeTransport.attest against a raw-socket peer that stalls in
 * a scripted way, and reports whether/when the returned stage completes.
 * usage: StallProbe <scenario> <waitSeconds>
 */
public final class StallProbe {
    static final String OK_BODY = "{\"protocolVersion\":2,\"runtimeInstanceId\":\"rt-1\",\"runtimeIncarnation\":\"inc-1\",\"leaseId\":\"lease-1\",\"epoch\":1,\"provisionRequestId\":\"prov-1\",\"tenantId\":\"tenant-1\",\"workspaceId\":\"ws-1\",\"workspaceGeneration\":\"gen-1\",\"workspaceCwd\":\"/w\",\"capabilityDigest\":\"sha256:x\",\"isolationClass\":\"workspace\"}";

    public static void main(String[] args) throws Exception {
        String scenario = args[0];
        int wait = Integer.parseInt(args[1]);
        int calls = args.length > 2 ? Integer.parseInt(args[2]) : 1;
        ServerSocket ss = new ServerSocket(0, 2000, InetAddress.getLoopbackAddress());
        List<Socket> held = Collections.synchronizedList(new ArrayList<>());
        Thread acceptor = new Thread(() -> {
            while (true) {
                try {
                    Socket s = ss.accept();
                    held.add(s);
                    new Thread(() -> serve(s, scenario)).start();
                } catch (IOException e) { return; }
            }
        });
        acceptor.setDaemon(true);
        acceptor.start();

        RuntimeScope scope = new RuntimeScope("tenant-1", "ws-1", "gen-1", "/w", "sha256:x", "workspace");
        RuntimeLease lease = new RuntimeLease("rt-1", URI.create("http://127.0.0.1:" + ss.getLocalPort() + "/"), "tok-1", "lease-1", 1);
        RuntimeProvisionSeed seed = new RuntimeProvisionSeed("prov-1", "rt-1", "inc-1", "lease-1", 1, "tok-1");
        HttpRuntimeTransport transport = new HttpRuntimeTransport();
        long t0 = System.nanoTime();
        List<CompletableFuture<RuntimeAttestation>> fs = new ArrayList<>();
        for (int i = 0; i < calls; i++) {
            fs.add(transport.attest(lease, new RuntimeProvisionRequest(scope, null), seed).toCompletableFuture());
        }
        System.out.println("java=" + System.getProperty("java.version") + " scenario=" + scenario + " calls=" + calls + " wait=" + wait + "s");
        for (CompletableFuture<RuntimeAttestation> f : fs) {
            long left = Math.max(1, wait * 1000L - (System.nanoTime() - t0) / 1_000_000);
            try {
                RuntimeAttestation a = f.get(left, TimeUnit.MILLISECONDS);
                System.out.printf("  RESULT ok after %.1fs incarnation=%s%n", secs(t0), a.getRuntimeIncarnation());
            } catch (TimeoutException e) {
                System.out.printf("  RESULT STILL-PENDING after %.1fs (caller gave up)%n", secs(t0));
            } catch (ExecutionException e) {
                Throwable c = e.getCause();
                if (c instanceof RuntimeBrokerException r) {
                    System.out.printf("  RESULT failed after %.1fs status=%d code=%s retryable=%s cause=%s%n", secs(t0), r.getStatusCode(), r.getCode(), r.isRetryable(), r.getCause() == null ? "-" : r.getCause().getClass().getSimpleName());
                } else {
                    System.out.printf("  RESULT failed after %.1fs raw=%s%n", secs(t0), c);
                }
            }
        }
        // who is parked, and where
        int parked = 0;
        for (Map.Entry<Thread, StackTraceElement[]> e : Thread.getAllStackTraces().entrySet()) {
            boolean inRead = false;
            for (StackTraceElement el : e.getValue()) {
                if (el.getMethodName().equals("readAtMost")) inRead = true;
            }
            if (inRead) {
                parked++;
                if (parked == 1) {
                    System.out.println("  PARKED thread=\"" + e.getKey().getName() + "\" state=" + e.getKey().getState());
                    StackTraceElement[] st = e.getValue();
                    for (int i = 0; i < Math.min(st.length, 40); i++) {
                        String s = st[i].toString();
                        if (s.contains("readAtMost") || s.contains("lambda$attest") || s.contains("HttpResponseInputStream.read") || s.contains("LinkedBlockingQueue.take") || s.contains("ThreadPoolExecutor.runWorker") || s.contains("SelectorManager"))
                            System.out.println("      at " + s);
                    }
                }
            }
        }
        if (System.getenv("HOLD") != null) {
            System.out.println("  SERVERPORT=" + ss.getLocalPort());
            System.out.flush();
            Thread.sleep(Long.parseLong(System.getenv("HOLD")));
        }
        System.out.println("  threads parked in readAtMost=" + parked + " liveThreads=" + ManagementFactory.getThreadMXBean().getThreadCount());
        if (args.length > 3) {
            // follow-up: a healthy call on the SAME transport while stalled ones are parked
            ServerSocket ok = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
            Thread t = new Thread(() -> { try { Socket s = ok.accept(); serve(s, "ok"); } catch (IOException e) { } });
            t.setDaemon(true); t.start();
            RuntimeLease l2 = new RuntimeLease("rt-1", URI.create("http://127.0.0.1:" + ok.getLocalPort() + "/"), "tok-1", "lease-1", 1);
            long t1 = System.nanoTime();
            try {
                transport.attest(l2, new RuntimeProvisionRequest(scope, null), seed).toCompletableFuture().get(10, TimeUnit.SECONDS);
                System.out.printf("  FOLLOWUP healthy call on same transport ok after %.2fs%n", secs(t1));
            } catch (Exception e) {
                System.out.printf("  FOLLOWUP healthy call on same transport: %s after %.2fs%n", e.getClass().getSimpleName(), secs(t1));
            }
            long t2 = System.nanoTime();
            try {
                int v = CompletableFuture.supplyAsync(() -> 42).get(5, TimeUnit.SECONDS);
                System.out.printf("  FOLLOWUP unrelated CompletableFuture.supplyAsync ok after %.2fs%n", secs(t2));
            } catch (Exception e) {
                System.out.printf("  FOLLOWUP unrelated CompletableFuture.supplyAsync: %s after %.2fs%n", e.getClass().getSimpleName(), secs(t2));
            }
            System.out.println("  commonPool parallelism=" + ForkJoinPool.commonPool().getParallelism() + " poolSize=" + ForkJoinPool.commonPool().getPoolSize());
        }
        System.exit(0);
    }

    static double secs(long t0) { return (System.nanoTime() - t0) / 1e9; }

    static void serve(Socket s, String scenario) {
        try {
            InputStream in = s.getInputStream();
            ByteArrayOutputStream head = new ByteArrayOutputStream();
            int b, st = 0;
            while ((b = in.read()) >= 0) {
                head.write(b);
                st = (b == '\r' || b == '\n') ? st + 1 : 0;
                if (st == 4) break;
            }
            String h = head.toString(StandardCharsets.ISO_8859_1);
            int cl = 0;
            for (String line : h.split("\r\n")) if (line.toLowerCase().startsWith("content-length:")) cl = Integer.parseInt(line.substring(15).trim());
            in.readNBytes(cl);
            OutputStream out = s.getOutputStream();
            String hdr = "HTTP/1.1 200 OK\r\nCache-Control: no-store\r\nContent-Type: application/json; charset=utf-8\r\n";
            byte[] body = OK_BODY.getBytes(StandardCharsets.UTF_8);
            switch (scenario) {
                case "ok" -> { out.write((hdr + "Content-Length: " + body.length + "\r\n\r\n").getBytes()); out.write(body); out.flush(); }
                case "no-headers" -> { /* accept, read request, never answer */ }
                case "headers-then-stall" -> { out.write((hdr + "Content-Length: " + body.length + "\r\n\r\n").getBytes()); out.flush(); }
                case "partial-body-stall" -> { out.write((hdr + "Content-Length: " + body.length + "\r\n\r\n").getBytes()); out.write(body, 0, 40); out.flush(); }
                case "chunked-stall" -> { out.write((hdr + "Transfer-Encoding: chunked\r\n\r\n").getBytes()); out.write(("28\r\n").getBytes()); out.write(body, 0, 40); out.write("\r\n".getBytes()); out.flush(); }
                case "503-stall" -> { out.write(("HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/html\r\nContent-Length: 5000\r\n\r\n<html>").getBytes()); out.flush(); }
                case "drip" -> { // one byte every 2s, complete body eventually (~ 10 min)
                    out.write((hdr + "Content-Length: " + body.length + "\r\n\r\n").getBytes()); out.flush();
                    for (byte x : body) { out.write(x); out.flush(); Thread.sleep(2000); }
                }
                default -> throw new IllegalArgumentException(scenario);
            }
            Thread.sleep(3_600_000); // hold the socket open, send nothing more
        } catch (Exception e) {
            // peer closed
        }
    }
}
