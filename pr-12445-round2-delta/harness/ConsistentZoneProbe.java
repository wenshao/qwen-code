package com.alibaba.qwen.code.runtimebroker;

import java.lang.reflect.Method;
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
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;

/** One pool config per run (consistent deployment); usage: ConsistentZoneProbe <url> */
public final class ConsistentZoneProbe {
    static final class Ds implements DataSource {
        final String url;
        Ds(String url) { this.url = url; }
        public Connection getConnection() throws SQLException { return DriverManager.getConnection(url, "root", ""); }
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
        final AtomicInteger cancels = new AtomicInteger();
        public CompletionStage<Void> acquire(RuntimeLease l, RuntimeSession s) { return CompletableFuture.completedFuture(null); }
        public CompletionStage<Object> control(RuntimeLease l, RuntimeSession s, Map<String, Object> o) { return CompletableFuture.completedFuture("ok"); }
        public CompletionStage<Map<String, Object>> execute(RuntimeLease l, RuntimeSession s, Map<String, Object> r) { return new CompletableFuture<>(); }
        public CompletionStage<Map<String, Object>> cancel(RuntimeLease l, RuntimeSession s, Map<String, Object> r) { cancels.incrementAndGet(); return CompletableFuture.completedFuture(Map.of("state", "cancel_requested")); }
        public CompletionStage<Boolean> release(RuntimeLease l, RuntimeSession s) { return CompletableFuture.completedFuture(true); }
    }

    static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    public static void main(String[] args) throws Exception {
        DataSource ds = new Ds(args[0]);
        JdbcRuntimeBrokerSchema.initialize(ds);
        String run = UUID.randomUUID().toString().substring(0, 6);
        try (Connection c = ds.getConnection(); var s = c.prepareStatement("SELECT @@session.time_zone, @@system_time_zone"); var r = s.executeQuery()) {
            r.next();
            System.out.println("session time_zone=" + r.getString(1) + " system=" + r.getString(2));
        }
        try (Connection c = ds.getConnection()) {
            System.out.println("databaseNow - Instant.now = " + Duration.between(Instant.now(), JdbcRepositorySupport.databaseNow(c)).toMinutes() + " min");
        }
        RuntimeScope scope = new RuntimeScope("tenant-" + run, "workspace", "generation", "/workspace", "capability", "workspace");
        Transport transport = new Transport();
        JdbcToolExecutionRepository executions = new JdbcToolExecutionRepository(ds);
        try (RuntimeBrokerService service = new RuntimeBrokerService(h -> CompletableFuture.completedFuture(scope),
                request -> CompletableFuture.completedFuture(new RuntimeLease("runtime-1", URI.create("http://127.0.0.1:4001"), "token", "lease-1", 1)),
                transport, new JdbcRuntimeBindingRepository(ds), new JdbcRuntimeSessionRepository(ds), executions,
                "broker-" + run, Duration.ofMinutes(1), Duration.ofMinutes(1))) {
            // Part 1: a running execution on a live broker is cancelled.
            String rs = "rs-" + run;
            service.acquire("h-" + run, rs, "bootstrap").toCompletableFuture().join();
            ToolExecutionRecord created = service.createExecution("h-" + run, rs, "k-" + run,
                    m("sessionId", rs, "promptId", "p", "callId", "c", "argsDigest", "d")).toCompletableFuture().join();
            System.out.println("[cancel] created state=" + created.getState() + " leaseUntil=" + created.getDispatchLeaseUntil() + " now=" + Instant.now());
            ToolExecutionRecord cancelled = service.cancelExecution("h-" + run, rs, created.getExecutionCallId()).toCompletableFuture().join();
            System.out.println("[cancel] after cancelExecution state=" + cancelled.getState() + " transport.cancel calls=" + transport.cancels.get());
            ToolExecutionRecord retried = service.cancelExecution("h-" + run, rs, created.getExecutionCallId()).toCompletableFuture().join();
            System.out.println("[cancel] after a retried cancelExecution state=" + retried.getState() + " transport.cancel calls=" + transport.cancels.get());

            // Part 2: a dead owner's EXECUTING row with an expired 1 s lease; does the service drive recovery?
            String p = "dead-" + run;
            executions.findOrCreate(ToolExecutionRecord.prepared(p + "-exec", p + "-key", p + "-binding", 1,
                    p + "-harness", p + "-rs", p + "-turn", p + "-tool", p + "-digest",
                    m("sessionId", p + "-rs", "promptId", p + "-turn", "callId", p + "-tool", "argsDigest", p + "-digest")));
            ToolExecutionRecord claim = executions.claimDispatch(p + "-exec", "dead-broker", Duration.ofSeconds(1));
            executions.compareAndSet(claim, claim.withState(ToolExecutionRecord.State.EXECUTING, false), "dead-broker", claim.getDispatchGeneration());
            Thread.sleep(2500);
            ToolExecutionRecord row = executions.findByExecutionCallId(p + "-exec");
            Method drive = RuntimeBrokerService.class.getDeclaredMethod("shouldDriveDispatch", ToolExecutionRecord.class);
            drive.setAccessible(true);
            System.out.println("[dead owner] 2.5 s after taking a 1 s lease (~1.5 s past expiry): state=" + row.getState() + " leaseUntil=" + row.getDispatchLeaseUntil()
                    + " shouldDriveDispatch=" + drive.invoke(service, row)
                    + " repo claim by another broker -> " + describe(executions.claimDispatch(p + "-exec", "other-broker", Duration.ofMinutes(1)), executions, p + "-exec"));
        }
        System.exit(0);
    }

    static String describe(ToolExecutionRecord r, JdbcToolExecutionRepository repo, String id) {
        return (r == null ? "null" : "granted gen " + r.getDispatchGeneration()) + ", row now " + repo.findByExecutionCallId(id).getState();
    }
}
