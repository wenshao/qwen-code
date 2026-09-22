package com.alibaba.qwen.code.runtimebroker;

import java.net.URI;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;

/**
 * Broker A claims, then (before its CAS into EXECUTING) broker B takes the claim over and,
 * in arm "executing", also moves the row to EXECUTING. Does A still call transport.execute?
 * usage: TakeoverRaceProbe <jdbc|memory> <claim-only|executing>
 */
public final class TakeoverRaceProbe {
    static final class Ds implements DataSource {
        final String url;
        Ds(String url) { this.url = url; }
        public Connection getConnection() throws SQLException { return DriverManager.getConnection(url, "sa", ""); }
        public Connection getConnection(String u, String p) throws SQLException { return getConnection(); }
        public java.io.PrintWriter getLogWriter() { return null; }
        public void setLogWriter(java.io.PrintWriter out) { }
        public void setLoginTimeout(int s) { }
        public int getLoginTimeout() { return 0; }
        public java.util.logging.Logger getParentLogger() { return null; }
        public <T> T unwrap(Class<T> i) { return null; }
        public boolean isWrapperFor(Class<?> i) { return false; }
    }

    static final class Transport implements RuntimeTransport {
        final AtomicInteger executes = new AtomicInteger();
        public CompletionStage<Void> acquire(RuntimeLease l, RuntimeSession s) { return CompletableFuture.completedFuture(null); }
        public CompletionStage<Object> control(RuntimeLease l, RuntimeSession s, Map<String, Object> o) { return CompletableFuture.completedFuture("ok"); }
        public CompletionStage<Map<String, Object>> execute(RuntimeLease l, RuntimeSession s, Map<String, Object> r) { executes.incrementAndGet(); return new CompletableFuture<>(); }
        public CompletionStage<Map<String, Object>> cancel(RuntimeLease l, RuntimeSession s, Map<String, Object> r) { return CompletableFuture.completedFuture(Map.of("state", "cancel_requested")); }
        public CompletionStage<Boolean> release(RuntimeLease l, RuntimeSession s) { return CompletableFuture.completedFuture(true); }
    }

    /** A's view of the repository; before A's first CAS, broker B acts on the shared store. */
    static final class Interposed implements ToolExecutionRepository {
        final ToolExecutionRepository d;
        final boolean bEnters;
        final AtomicBoolean fired = new AtomicBoolean();
        volatile String bLog = "B did nothing";
        Interposed(ToolExecutionRepository d, boolean bEnters) { this.d = d; this.bEnters = bEnters; }
        public ToolExecutionRecord findOrCreate(ToolExecutionRecord c) { return d.findOrCreate(c); }
        public ToolExecutionRecord findByExecutionCallId(String id) { return d.findByExecutionCallId(id); }
        public ToolExecutionRecord findByIdempotencyKey(String k) { return d.findByIdempotencyKey(k); }
        public ToolExecutionRecord compareAndSet(ToolExecutionRecord e, ToolExecutionRecord r, String o, long g) {
            if (fired.compareAndSet(false, true)) {
                try { Thread.sleep(1500); } catch (InterruptedException x) { throw new IllegalStateException(x); } // A pauses past its 1 s lease
                ToolExecutionRecord b = d.claimDispatch(e.getExecutionCallId(), "broker-B", Duration.ofMinutes(5));
                bLog = "B claim -> " + (b == null ? "null" : "gen " + b.getDispatchGeneration() + " " + b.getState());
                if (b != null && bEnters) {
                    ToolExecutionRecord x = d.compareAndSet(b, b.withState(ToolExecutionRecord.State.EXECUTING, false), "broker-B", b.getDispatchGeneration());
                    bLog += "; B CAS -> " + (x == null ? "null" : x.getState());
                }
            }
            return d.compareAndSet(e, r, o, g);
        }
        public ToolExecutionRecord claimDispatch(String id, String o, Duration l) { return d.claimDispatch(id, o, l); }
        public ToolExecutionRecord renewDispatch(String id, String o, long g, Duration l) { return d.renewDispatch(id, o, g, l); }
        public ToolExecutionRecord requestCancel(String id, long v) { return d.requestCancel(id, v); }
        public ToolExecutionRecord resolveUnknown(ToolExecutionRecord e, Map<String, Object> r, Instant t) { return d.resolveUnknown(e, r, t); }
        public boolean hasActiveByRuntimeSession(String id) { return d.hasActiveByRuntimeSession(id); }
    }

    public static void main(String[] args) throws Exception {
        String run = UUID.randomUUID().toString().substring(0, 6);
        ToolExecutionRepository shared;
        if (args[0].equals("jdbc")) {
            DataSource ds = new Ds("jdbc:h2:mem:race" + run + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
            JdbcRuntimeBrokerSchema.initialize(ds);
            shared = new JdbcToolExecutionRepository(ds);
        } else {
            shared = new InMemoryToolExecutionRepository();
        }
        Interposed repoA = new Interposed(shared, args[1].equals("executing"));
        RuntimeScope scope = new RuntimeScope("tenant-" + run, "workspace", "generation", "/workspace", "capability", "workspace");
        Transport transportA = new Transport();
        try (RuntimeBrokerService a = new RuntimeBrokerService(h -> CompletableFuture.completedFuture(scope),
                request -> CompletableFuture.completedFuture(new RuntimeLease("runtime-1", URI.create("http://127.0.0.1:4001"), "token", "lease-1", 1)),
                transportA, new InMemoryRuntimeBindingRepository(), new InMemoryRuntimeSessionRepository(), repoA,
                "broker-A", Duration.ofMinutes(1), Duration.ofSeconds(1))) {
            String rs = "rs-" + run;
            a.acquire("h-" + run, rs, "bootstrap").toCompletableFuture().join();
            ToolExecutionRecord r = a.createExecution("h-" + run, rs, "k-" + run,
                    Map.of("sessionId", rs, "promptId", "p", "callId", "c", "argsDigest", "d")).toCompletableFuture().join();
            System.out.println(args[0] + "/" + args[1] + ": " + repoA.bLog + "; row owner=" + r.getDispatchOwner()
                    + " gen=" + r.getDispatchGeneration() + " state=" + r.getState()
                    + "; broker A transport.execute calls=" + transportA.executes.get());
        }
        System.exit(0);
    }
}
