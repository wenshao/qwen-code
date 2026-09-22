package com.alibaba.qwen.code.runtimebroker;

import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import javax.sql.DataSource;

/**
 * Two dispatcher pools on one MySQL database whose sessions disagree on
 * time_zone (pool B forces Asia/Shanghai onto its session). The ledger's
 * lease clock is `SELECT CURRENT_TIMESTAMP`, which is session-zone dependent.
 *
 * usage: TzProbe <urlA> <urlB> <run>
 */
public final class TzProbe {
    private TzProbe() {
    }

    public static void main(String[] args) throws Exception {
        DataSource a = HarnessSupport.dataSource(args[0], "root", "");
        DataSource b = HarnessSupport.dataSource(args[1], "root", "");
        String run = args[2];
        HarnessSupport.install(a);
        JdbcToolExecutionRepository poolA = new JdbcToolExecutionRepository(a);
        JdbcToolExecutionRepository poolB = new JdbcToolExecutionRepository(b);
        System.out.println("wall clock            : " + Instant.now());
        System.out.println("pool A databaseNow()  : " + now(a) + "   (session time_zone " + zone(a) + ")");
        System.out.println("pool B databaseNow()  : " + now(b) + "   (session time_zone " + zone(b) + ")");

        // 1. live DISPATCHING claim held by A (30 minute lease); B asks for it.
        String p1 = run + "-dispatching";
        poolA.findOrCreate(HarnessSupport.candidate(p1, HarnessSupport.reference(p1)));
        ToolExecutionRecord claimA = poolA.claimDispatch(p1 + "-exec", "dispatcher-A",
                Duration.ofMinutes(30));
        System.out.println();
        System.out.println("[1] A claims            : gen " + claimA.getDispatchGeneration()
                + ", lease until " + claimA.getDispatchLeaseUntil());
        ToolExecutionRecord claimB = poolB.claimDispatch(p1 + "-exec", "dispatcher-B",
                Duration.ofMinutes(30));
        System.out.println("[1] B claims right after: " + (claimB == null ? "null (fenced)"
                : "GRANTED gen " + claimB.getDispatchGeneration() + " to " + claimB.getDispatchOwner()
                        + "  <- A's 30-minute claim is still live: a healthy claim is taken over"));
        ToolExecutionRecord startA = poolA.compareAndSet(claimA,
                claimA.withState(ToolExecutionRecord.State.EXECUTING, false),
                "dispatcher-A", claimA.getDispatchGeneration());
        System.out.println("[1] A moves to EXECUTING: " + (startA == null
                ? "null (A is fenced out; B now owns the call)" : startA.getState().toString()));

        // 2. live EXECUTING claim held by A; B's claim attempt.
        String p2 = run + "-executing";
        poolA.findOrCreate(HarnessSupport.candidate(p2, HarnessSupport.reference(p2)));
        ToolExecutionRecord c2 = poolA.claimDispatch(p2 + "-exec", "dispatcher-A", Duration.ofMinutes(30));
        ToolExecutionRecord executing = poolA.compareAndSet(c2,
                c2.withState(ToolExecutionRecord.State.EXECUTING, false), "dispatcher-A",
                c2.getDispatchGeneration());
        ToolExecutionRecord b2 = poolB.claimDispatch(p2 + "-exec", "dispatcher-B", Duration.ofMinutes(30));
        ToolExecutionRecord after2 = poolA.findByExecutionCallId(p2 + "-exec");
        System.out.println();
        System.out.println("[2] A is EXECUTING (30 min lease); B claims -> " + (b2 == null ? "null" : "granted")
                + ", row is now " + after2.getState());
        ToolExecutionRecord settle2 = poolA.compareAndSet(executing,
                executing.withResult(java.util.Map.of("executionStatus", "success"), 1, Instant.EPOCH),
                "dispatcher-A", executing.getDispatchGeneration());
        System.out.println("[2] A settles           : " + (settle2 == null
                ? "null  <- a healthy, running execution was forced to UNKNOWN; its result is refused" : settle2.getState().toString()));

        // 3. the reverse direction: B claims, A sees the lease 8 h into the future.
        String p3 = run + "-reverse";
        poolB.findOrCreate(HarnessSupport.candidate(p3, HarnessSupport.reference(p3)));
        ToolExecutionRecord c3 = poolB.claimDispatch(p3 + "-exec", "dispatcher-B", Duration.ofSeconds(1));
        Thread.sleep(2500);
        ToolExecutionRecord a3 = poolA.claimDispatch(p3 + "-exec", "dispatcher-A", Duration.ofMinutes(30));
        System.out.println();
        System.out.println("[3] B claims with a 1 s lease (until " + c3.getDispatchLeaseUntil() + "), dies;"
                + " A claims 2.5 s later -> " + (a3 == null ? "null: lease still looks live for "
                        + Duration.between(now(a), c3.getDispatchLeaseUntil()).toMinutes() + " more minutes"
                        : "granted"));
    }

    private static Instant now(DataSource ds) throws Exception {
        try (Connection c = ds.getConnection()) {
            return JdbcRepositorySupport.databaseNow(c);
        }
    }

    private static String zone(DataSource ds) throws Exception {
        try (Connection c = ds.getConnection(); var s = c.prepareStatement("SELECT @@session.time_zone");
                var r = s.executeQuery()) {
            r.next();
            return r.getString(1);
        }
    }
}
