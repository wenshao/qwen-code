package com.alibaba.qwen.code.runtimebroker;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Supplier;
import javax.sql.DataSource;
import org.h2.jdbcx.JdbcDataSource;

/**
 * Lock-step differential fuzz: InMemoryToolExecutionRepository (the merged reference, #12391) vs
 * JdbcToolExecutionRepository on the same random operation sequence. Every outcome is projected
 * (record fields, lease live/expired, canonical payload comparison, or exception class+message) and compared.
 */
public class DiffFuzz {
    static final class MutableClock extends Clock {
        Instant now = Instant.now();
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId z) { return this; }
        public Instant instant() { return now; }
    }

    static DataSource ds;
    static String prefix;

    static String project(Object o, Instant now) {
        if (o == null) return "null";
        if (o instanceof Boolean b) return "bool " + b;
        ToolExecutionRecord r = (ToolExecutionRecord) o;
        String lease = r.getDispatchLeaseUntil() == null ? "none" : r.getDispatchLeaseUntil().isAfter(now) ? "live" : "expired";
        return r.getExecutionCallId().replace(prefix, "") + " key=" + r.getIdempotencyKey().replace(prefix, "") + " " + r.getState()
                + " status=" + r.getExecutionStatus() + " seq=" + r.getLastSequence() + " cancel=" + r.isCancelRequested()
                + " owner=" + r.getDispatchOwner() + " lease=" + lease + " gen=" + r.getDispatchGeneration()
                + " v=" + r.getVersion() + " settled=" + (r.getSettledAt() != null);
    }

    static boolean samePayloads(Object a, Object b) {
        if (!(a instanceof ToolExecutionRecord x) || !(b instanceof ToolExecutionRecord y)) return true;
        return BrokerValues.sameJsonMap(x.getReference(), y.getReference())
                && (x.getResult() == null ? y.getResult() == null : y.getResult() != null && BrokerValues.sameJsonMap(x.getResult(), y.getResult()));
    }

    static Object[] call(Supplier<Object> s) {
        try { return new Object[] {s.get(), null}; }
        catch (Throwable t) {
            String m = t.getMessage();
            return new Object[] {null, t.getClass().getSimpleName() + ": " + m};
        }
    }

    public static void main(String[] args) throws Exception {
        String db = args[0];
        int sequences = Integer.parseInt(args[1]);
        int ops = Integer.parseInt(args[2]);
        long seed0 = Long.parseLong(args[3]);
        if (db.equals("h2")) {
            JdbcDataSource h2 = new JdbcDataSource();
            h2.setURL("jdbc:h2:mem:fz-" + UUID.randomUUID() + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
            ds = h2;
        } else {
            ds = new DriverManagerDataSource(db, "root", "");
        }
        JdbcRuntimeBrokerSchema.initialize(ds);
        TreeMap<String, Integer> opHist = new TreeMap<>();
        TreeMap<String, Integer> outcomeHist = new TreeMap<>();
        int divergent = 0;
        long total = 0;
        for (int s = 0; s < sequences; s++) {
            long seed = seed0 + s;
            Random r = new Random(seed);
            prefix = "f" + seed + "-" + UUID.randomUUID().toString().substring(0, 4) + "-";
            MutableClock clock = new MutableClock();
            InMemoryToolExecutionRepository mem = new InMemoryToolExecutionRepository(clock);
            JdbcToolExecutionRepository jdbc = new JdbcToolExecutionRepository(ds);
            List<ToolExecutionRecord> hm = new ArrayList<>();
            List<ToolExecutionRecord> hj = new ArrayList<>();
            List<String> trace = new ArrayList<>();
            for (int i = 0; i < ops; i++) {
                int op = r.nextInt(100);
                String e = prefix + "E" + r.nextInt(5);
                String k = prefix + "K" + r.nextInt(4);
                String o = "O" + r.nextInt(3);
                int h = hm.isEmpty() ? -1 : r.nextInt(hm.size());
                Object[] am, aj;
                String name;
                if (op < 14) {
                    String rs = prefix + "RS" + r.nextInt(2);
                    String dg = "D" + r.nextInt(2);
                    long attempt = r.nextInt(2);
                    Supplier<ToolExecutionRecord> cand = () -> ToolExecutionRecord.prepared(e, k, "B", 1, "H", rs, "T", "C", dg,
                            Map.of("sessionId", rs, "promptId", "T", "callId", "C", "argsDigest", dg, "attempt", attempt, "w", 0.5d));
                    name = "findOrCreate(" + e.replace(prefix, "") + "," + k.replace(prefix, "") + "," + dg + ")";
                    am = call(() -> mem.findOrCreate(cand.get()));
                    aj = call(() -> jdbc.findOrCreate(cand.get()));
                } else if (op < 20) {
                    name = "findByExecutionCallId";
                    am = call(() -> mem.findByExecutionCallId(e)); aj = call(() -> jdbc.findByExecutionCallId(e));
                } else if (op < 25) {
                    name = "findByIdempotencyKey";
                    am = call(() -> mem.findByIdempotencyKey(k)); aj = call(() -> jdbc.findByIdempotencyKey(k));
                } else if (op < 42) {
                    name = "claimDispatch(" + o + ")";
                    am = call(() -> mem.claimDispatch(e, o, Duration.ofMinutes(10)));
                    aj = call(() -> jdbc.claimDispatch(e, o, Duration.ofMinutes(10)));
                } else if (op < 50 && h >= 0) {
                    long gen = hm.get(h).getDispatchGeneration() + r.nextInt(3) - 1;
                    String id = hm.get(h).getExecutionCallId();
                    name = "renewDispatch(gen" + (r.nextBoolean() ? "" : "") + ")";
                    am = call(() -> mem.renewDispatch(id, o, gen, Duration.ofMinutes(10)));
                    aj = call(() -> jdbc.renewDispatch(id, o, gen, Duration.ofMinutes(10)));
                } else if (op < 75 && h >= 0) {
                    int kind = r.nextInt(9);
                    boolean ownOwner = r.nextInt(4) != 0;
                    boolean ownGen = r.nextInt(4) != 0;
                    long seq = r.nextInt(3);
                    name = "compareAndSet(kind" + kind + (ownOwner ? "" : ",otherOwner") + (ownGen ? "" : ",otherGen") + ")";
                    ToolExecutionRecord xm = hm.get(h), xj = hj.get(h);
                    String ow = ownOwner && xm.getDispatchOwner() != null ? xm.getDispatchOwner() : o;
                    long g = ownGen ? xm.getDispatchGeneration() : xm.getDispatchGeneration() + 1;
                    Instant t = Instant.parse("2026-09-22T00:00:00Z");
                    am = call(() -> mem.compareAndSet(xm, replacement(xm, kind, seq, t), ow, g));
                    aj = call(() -> jdbc.compareAndSet(xj, replacement(xj, kind, seq, t), ow, g));
                } else if (op < 84 && h >= 0) {
                    long v = hm.get(h).getVersion() + r.nextInt(3) - 1;
                    String id = hm.get(h).getExecutionCallId();
                    name = "requestCancel";
                    am = call(() -> mem.requestCancel(id, v)); aj = call(() -> jdbc.requestCancel(id, v));
                } else if (op < 90 && h >= 0) {
                    ToolExecutionRecord xm = hm.get(h), xj = hj.get(h);
                    Map<String, Object> res = Map.of("executionStatus", r.nextBoolean() ? "error" : "success", "n", 7L);
                    Instant t = Instant.parse("2026-09-22T00:00:01Z");
                    name = "resolveUnknown";
                    am = call(() -> mem.resolveUnknown(xm, res, t)); aj = call(() -> jdbc.resolveUnknown(xj, res, t));
                } else if (op < 95) {
                    String rs = prefix + "RS" + r.nextInt(2);
                    name = "hasActiveByRuntimeSession";
                    am = call(() -> mem.hasActiveByRuntimeSession(rs)); aj = call(() -> jdbc.hasActiveByRuntimeSession(rs));
                } else {
                    name = "expireAllLeases";
                    clock.now = clock.now.plus(Duration.ofHours(1));
                    try (Connection c = ds.getConnection(); PreparedStatement p = c.prepareStatement(
                            "UPDATE qwen_tool_execution SET dispatch_lease_until = ? WHERE execution_call_id LIKE ? AND dispatch_lease_until IS NOT NULL")) {
                        p.setTimestamp(1, java.sql.Timestamp.valueOf("2000-01-01 00:00:00"));
                        p.setString(2, prefix + "%");
                        p.executeUpdate();
                    }
                    am = new Object[] {null, null}; aj = new Object[] {null, null};
                }
                total++;
                String pm = am[1] != null ? "THROWS " + am[1] : project(am[0], clock.instant());
                String pj = aj[1] != null ? "THROWS " + aj[1] : project(aj[0], Instant.now());
                opHist.merge(name.replaceAll("\\(.*", ""), 1, Integer::sum);
                outcomeHist.merge(pm.startsWith("THROWS") ? "exception" : pm.equals("null") ? "null" : pm.startsWith("bool") ? pm : "record", 1, Integer::sum);
                trace.add(String.format("  #%d %-40s mem=%s%n  %45s jdbc=%s", i, name, pm, "", pj));
                if (!pm.equals(pj) || !samePayloads(am[0], aj[0])) {
                    divergent++;
                    System.out.println("DIVERGENCE seed=" + seed + " at op #" + i);
                    trace.subList(Math.max(0, trace.size() - 6), trace.size()).forEach(System.out::println);
                    break;
                }
                if (am[0] instanceof ToolExecutionRecord xm && aj[0] instanceof ToolExecutionRecord xj) { hm.add(xm); hj.add(xj); }
            }
        }
        System.out.println("db=" + (db.startsWith("jdbc") ? db.replaceAll("\\?.*", "") : db) + " sequences=" + sequences + " ops/seq=" + ops
                + " seeds=" + seed0 + ".." + (seed0 + sequences - 1) + " ops executed=" + total + " divergent sequences=" + divergent);
        System.out.println("  ops     : " + opHist);
        System.out.println("  outcomes: " + outcomeHist);
    }

    static ToolExecutionRecord replacement(ToolExecutionRecord x, int kind, long seq, Instant t) {
        switch (kind) {
            case 0: case 1: return x.withState(ToolExecutionRecord.State.EXECUTING, x.isCancelRequested());
            case 2: return x.withState(ToolExecutionRecord.State.CANCEL_REQUESTED, true);
            case 3: return x.withResult(Map.of("executionStatus", "success", "out", List.of(1L, "a")), x.getLastSequence() + seq, t);
            case 4: return x.withResult(Map.of("executionStatus", "cancelled"), x.getLastSequence(), t);
            case 5: return x.withState(ToolExecutionRecord.State.DISPATCHING, x.isCancelRequested());
            case 6: return x.withState(ToolExecutionRecord.State.PREPARED, false);
            case 7: return x.withUnknown();
            default: return x.withState(x.getState(), false);
        }
    }
}
