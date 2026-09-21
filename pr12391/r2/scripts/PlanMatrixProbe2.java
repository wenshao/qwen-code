package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.qwen.code.runtimebroker.ToolExecutionRecord.State;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Clause-level variant (lives in the module package so a package-private constructor stays reachable).
 * One probe matrix, several arms: PR head (unfenced 2-arg CAS), L1 (author's plan, literal),
 * C (plan + remaining clauses). Arm-specific methods are reached by reflection so the same
 * binary runs against each arm's classes. Every caller passes ITS OWN claim token.
 * Prints one TSV row per probe: id, outcome (OPEN / closed / STUCK / ok / BROKEN), detail.
 */
public final class PlanMatrixProbe2 {
    static final Instant T0 = Instant.parse("2026-09-21T00:00:00Z");
    static final Duration LEASE = Duration.ofSeconds(30);
    static Method cas4;
    static Method cas2;
    static Method requestCancel;
    static Method resolveRepo;

    static final class MClock extends Clock {
        Instant now = T0;
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
        void adv(long seconds) { now = now.plusSeconds(seconds); }
    }

    static final class Refused extends Exception {
        Refused(String m) { super(m); }
    }

    static Map<String, Object> ref() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("sessionId", "session");
        m.put("promptId", "turn");
        m.put("callId", "tool");
        m.put("argsDigest", "digest");
        return m;
    }

    static Map<String, Object> result(String s) {
        return Map.of("executionStatus", s);
    }

    static ToolExecutionRecord prepared(String id) {
        return ToolExecutionRecord.prepared(id, "key-" + id, "binding", 1, "harness", "session",
                "turn", "tool", "digest", ref());
    }

    static ToolExecutionRecord rebuild(ToolExecutionRecord r, State state, String owner,
            Instant lease, long generation, long lastSequence, boolean cancel) {
        return new ToolExecutionRecord(r.getExecutionCallId(), r.getIdempotencyKey(),
                r.getBindingId(), r.getRuntimeGeneration(), r.getHarnessSessionId(),
                r.getRuntimeSessionId(), r.getTurnId(), r.getToolCallId(), r.getRequestDigest(),
                r.getReference(), state, null, null, lastSequence, cancel, owner, lease,
                generation, r.getVersion(), null);
    }

    static Object call(Method m, Object target, Object... args) throws Refused {
        try {
            return m.invoke(target, args);
        } catch (InvocationTargetException e) {
            Throwable c = e.getCause();
            throw new Refused("threw " + c.getClass().getSimpleName() + ": " + c.getMessage());
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        }
    }

    /** CAS as the given actor; head ignores the actor (it has no such parameter). */
    static ToolExecutionRecord cas(InMemoryToolExecutionRepository repo, ToolExecutionRecord expected,
            ToolExecutionRecord replacement, String owner, long generation) throws Refused {
        Object r = cas4 != null ? call(cas4, repo, expected, replacement, owner, generation)
                : call(cas2, repo, expected, replacement);
        if (r == null) {
            throw new Refused("null");
        }
        return (ToolExecutionRecord) r;
    }

    /** Host-side cancel intent: dedicated method when present, else the head's CAS route. */
    static ToolExecutionRecord cancel(InMemoryToolExecutionRepository repo, String id) throws Refused {
        if (requestCancel != null) {
            Object r = call(requestCancel, repo, id);
            if (r == null) {
                throw new Refused("null");
            }
            return (ToolExecutionRecord) r;
        }
        ToolExecutionRecord cur = repo.findByExecutionCallId(id);
        State next = cur.getState() == State.DISPATCHING || cur.getState() == State.EXECUTING
                ? State.CANCEL_REQUESTED : cur.getState();
        return cas(repo, cur, cur.withState(next, true), "host", 0);
    }

    /** Resolve UNKNOWN: dedicated repository method when present; otherwise the only route is CAS. */
    static ToolExecutionRecord resolve(InMemoryToolExecutionRepository repo, String id, long gen,
            String formerOwner, Instant now) throws Refused {
        if (resolveRepo != null) {
            Object r = call(resolveRepo, repo, id, gen, result("success"), now);
            if (r == null) {
                throw new Refused("null");
            }
            return (ToolExecutionRecord) r;
        }
        ToolExecutionRecord cur = repo.findByExecutionCallId(id);
        String first;
        try {
            return cas(repo, cur, cur.resolveUnknown(result("success"), now), formerOwner, gen);
        } catch (Refused e) {
            first = e.getMessage();
        }
        try {
            return cas(repo, cur, cur.resolveUnknown(result("success"), now), null, gen);
        } catch (Refused e) {
            throw new Refused("as former owner: " + first + "; as anyone: " + e.getMessage());
        }
    }


    /** Put "id" into UNKNOWN: the lease holder's own withUnknown() when the arm allows it, else via takeover. */
    static String toUnknown(InMemoryToolExecutionRepository repo, MClock clock, String id) throws Refused {
        ToolExecutionRecord v1 = repo.claimDispatch(id, "owner-a", LEASE);
        try {
            cas(repo, v1, v1.withUnknown(), "owner-a", 1);
            return "own withUnknown";
        } catch (Refused e) {
            ToolExecutionRecord cur = repo.findByExecutionCallId(id);
            cas(repo, cur, cur.withState(State.EXECUTING, false), "owner-a", 1);
            clock.adv(31);
            repo.claimDispatch(id, "owner-b", LEASE);
            ToolExecutionRecord now = repo.findByExecutionCallId(id);
            if (now.getState() != State.UNKNOWN) {
                throw new Refused("could not reach UNKNOWN: " + d(now));
            }
            return "takeover (own withUnknown refused)";
        }
    }

    static String d(ToolExecutionRecord r) {
        return r == null ? "null" : r.getState() + " v" + r.getVersion() + " owner="
                + r.getDispatchOwner() + " gen=" + r.getDispatchGeneration()
                + (r.isCancelRequested() ? " cancel" : "") + " seq=" + r.getLastSequence();
    }

    static void row(String id, String outcome, String detail) {
        System.out.println(id + "\t" + outcome + "\t" + detail.replace('\t', ' '));
    }

    interface Probe {
        void run() throws Exception;
    }

    static void guard(String id, Probe p) {
        try {
            p.run();
        } catch (Exception e) {
            row(id, "ERROR", e.toString());
        }
    }

    public static void main(String[] args) throws Exception {
        for (Method m : InMemoryToolExecutionRepository.class.getMethods()) {
            if (m.getName().equals("compareAndSet") && m.getParameterCount() == 4) {
                cas4 = m;
            } else if (m.getName().equals("compareAndSet") && m.getParameterCount() == 2) {
                cas2 = m;
            } else if (m.getName().equals("requestCancel")) {
                requestCancel = m;
            } else if (m.getName().equals("resolveUnknown")) {
                resolveRepo = m;
            }
        }
        System.out.println("#arm\t" + args[0] + "\tcas=" + (cas4 != null ? "fenced-4arg" : "")
                + (cas2 != null ? "+unfenced-2arg" : "") + " requestCancel=" + (requestCancel != null)
                + " resolveUnknown(repo)=" + (resolveRepo != null) + " java="
                + System.getProperty("java.version"));

        guard("P1", () -> {                       // stranger settles during owner-a's live lease
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("p1"));
            repo.claimDispatch("p1", "owner-a", LEASE);
            ToolExecutionRecord cur = repo.findByExecutionCallId("p1");
            try {
                ToolExecutionRecord r = cas(repo, cur, cur.withResult(result("error"), 0, T0), "stranger", 0);
                row("P1", "OPEN", "stranger settled: " + d(r));
            } catch (Refused e) {
                row("P1", "closed", "stranger refused (" + e.getMessage() + ")");
            }
        });
        guard("R1-4", () -> {                     // evicted owner re-reads and settles
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("r14"));
            repo.claimDispatch("r14", "owner-a", LEASE);
            clock.adv(31);
            repo.claimDispatch("r14", "owner-b", LEASE);
            clock.adv(1);
            ToolExecutionRecord cur = repo.findByExecutionCallId("r14");
            String out;
            try {
                cas(repo, cur, cur.withResult(result("error"), 0, clock.instant()), "owner-a", 1);
                out = "OPEN";
            } catch (Refused e) {
                out = "closed";
            }
            ToolExecutionRecord now = repo.findByExecutionCallId("r14");
            String bCtl;
            try {
                bCtl = "B settles: " + d(cas(repo, now, now.withResult(result("success"), 0,
                        clock.instant()), "owner-b", 2));
            } catch (Refused e) {
                bCtl = "B refused (" + e.getMessage() + ")";
            }
            row("R1-4", out, (out.equals("OPEN") ? "evicted A settled; " : "evicted A refused; ") + bCtl);
        });
        guard("R1-1b", () -> {                    // expired owner settles, nobody took over
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("k1b"));
            ToolExecutionRecord a = repo.claimDispatch("k1b", "owner-a", LEASE);
            clock.adv(31);
            try {
                cas(repo, a, a.withResult(result("success"), 0, clock.instant()), "owner-a", 1);
                row("R1-1b", "OPEN", "expired owner settled");
            } catch (Refused e) {
                row("R1-1b", "closed", "expired owner refused (" + e.getMessage() + ")");
            }
        });
        guard("R1-1a", () -> {                    // lease holder writes generation 3 -> 1, owner-a
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("k1a"));
            repo.claimDispatch("k1a", "owner-a", LEASE);
            clock.adv(31);
            repo.claimDispatch("k1a", "owner-b", LEASE);
            clock.adv(31);
            ToolExecutionRecord c = repo.claimDispatch("k1a", "owner-c", LEASE);
            try {
                ToolExecutionRecord r = cas(repo, c, rebuild(c, c.getState(), "owner-a",
                        clock.instant().plus(LEASE), 1, 0, false), "owner-c", 3);
                row("R1-1a", "OPEN", "generation regressed 3->1: " + d(r)
                        + "; renew(owner-a,1)=" + (repo.renewDispatch("k1a", "owner-a", 1, LEASE) != null));
            } catch (Refused e) {
                row("R1-1a", "closed", "claim rewrite refused (" + e.getMessage() + ")");
            }
        });
        guard("R1-5a", () -> {                    // claim drop mid-flight, then a 2nd dispatcher
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("r15a"));
            ToolExecutionRecord v1 = repo.claimDispatch("r15a", "dispatcher-a", LEASE);
            ToolExecutionRecord v2 = cas(repo, v1, v1.withState(State.EXECUTING, false), "dispatcher-a", 1);
            clock.adv(5);
            try {
                cas(repo, v2, rebuild(v2, State.EXECUTING, null, null, 1, 0, false), "dispatcher-a", 1);
            } catch (Refused e) {
                row("R1-5a", "closed", "claim drop refused (" + e.getMessage() + ")");
                return;
            }
            ToolExecutionRecord b = repo.claimDispatch("r15a", "dispatcher-b", LEASE);
            ToolExecutionRecord now = repo.findByExecutionCallId("r15a");
            if (b != null) {
                row("R1-5a", "OPEN", "drop accepted; dispatcher-b elected with 25s of A's lease left: " + d(b));
            } else {
                row("R1-5a", now.getState() == State.UNKNOWN ? "closed*" : "closed",
                        "drop accepted, dispatcher-b refused; record now " + d(now));
            }
        });
        guard("R1-5b", () -> {                    // UNKNOWN, then resume EXECUTING, then a 2nd claim
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("r15b"));
            String how = toUnknown(repo, clock, "r15b");
            ToolExecutionRecord u = repo.findByExecutionCallId("r15b");
            String resume;
            try {
                resume = "resume accepted: " + d(cas(repo, u, u.withState(State.EXECUTING, false),
                        "owner-a", 1));
            } catch (Refused e) {
                resume = "resume refused (" + e.getMessage() + ")";
            }
            ToolExecutionRecord b = repo.claimDispatch("r15b", "dispatcher-b", LEASE);
            row("R1-5b", b != null ? "OPEN" : "closed", "UNKNOWN via " + how + "; " + resume + "; claim(b)=" + d(b));
        });
        guard("R1-3a", () -> {                    // UNKNOWN -> PREPARED, then re-claim
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("k3a"));
            String how = toUnknown(repo, clock, "k3a");
            ToolExecutionRecord u = repo.findByExecutionCallId("k3a");
            try {
                cas(repo, u, u.withState(State.PREPARED, false), "owner-a", 1);
                ToolExecutionRecord b = repo.claimDispatch("k3a", "owner-c", LEASE);
                row("R1-3a", "OPEN", "UNKNOWN (" + how + ") escaped to PREPARED; re-claim " + d(b));
            } catch (Refused e) {
                row("R1-3a", "closed", "UNKNOWN via " + how + "; escape refused (" + e.getMessage() + ")");
            }
        });
        guard("OWN-UNKNOWN", () -> {              // the live lease holder records an ambiguous outcome itself
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("own"));
            ToolExecutionRecord v1 = repo.claimDispatch("own", "owner-a", LEASE);
            ToolExecutionRecord v2 = cas(repo, v1, v1.withState(State.EXECUTING, false), "owner-a", 1);
            try {
                ToolExecutionRecord r = cas(repo, v2, v2.withUnknown(), "owner-a", 1);
                row("OWN-UNKNOWN", "ok", "lease holder's withUnknown() accepted: " + d(r));
            } catch (Refused e) {
                row("OWN-UNKNOWN", "BLOCKED", "lease holder's withUnknown() refused (" + e.getMessage() + ")");
            }
        });
        guard("R1-3b1", () -> {                   // host requests cancel; owner then erases it
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("k3b"));
            ToolExecutionRecord v1 = repo.claimDispatch("k3b", "owner-a", LEASE);
            cas(repo, v1, v1.withState(State.EXECUTING, false), "owner-a", 1);
            ToolExecutionRecord c = cancel(repo, "k3b");
            try {
                ToolExecutionRecord r = cas(repo, c, c.withState(State.EXECUTING, false), "owner-a", 1);
                row("R1-3b1", "OPEN", "cancel intent erased: " + d(r));
            } catch (Refused e) {
                row("R1-3b1", "closed", "erase refused (" + e.getMessage() + ")");
            }
        });
        guard("R1-3b2", () -> {                   // CANCEL_REQUESTED with cancelRequested=false
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("k3c"));
            ToolExecutionRecord v1 = repo.claimDispatch("k3c", "owner-a", LEASE);
            ToolExecutionRecord incoherent;
            try {
                incoherent = v1.withState(State.CANCEL_REQUESTED, false);
            } catch (RuntimeException e) {
                row("R1-3b2", "closed", "incoherent record not constructible (" + e.getMessage() + ")");
                return;
            }
            try {
                cas(repo, v1, incoherent, "owner-a", 1);
            } catch (Refused e) {
                row("R1-3b2", "closed", "incoherent write refused (" + e.getMessage() + ")");
                return;
            }
            clock.adv(31);
            ToolExecutionRecord b = repo.claimDispatch("k3c", "owner-b", LEASE);
            row("R1-3b2", b != null && b.getState() == State.DISPATCHING ? "OPEN" : "closed",
                    "incoherent CANCEL_REQUESTED stored; after expiry claim(b)=" + d(b));
        });
        guard("R1-2", () -> {                     // expired-lease takeover of EXECUTING
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("k2"));
            ToolExecutionRecord v1 = repo.claimDispatch("k2", "owner-a", LEASE);
            cas(repo, v1, v1.withState(State.EXECUTING, false), "owner-a", 1);
            clock.adv(31);
            ToolExecutionRecord b = repo.claimDispatch("k2", "owner-b", LEASE);
            ToolExecutionRecord now = repo.findByExecutionCallId("k2");
            row("R1-2", b != null && b.getState() == State.DISPATCHING ? "OPEN" : "closed",
                    "takeover of EXECUTING -> claim(b)=" + d(b) + "; stored " + d(now));
        });
        guard("P11", () -> {                      // EXECUTING -> PREPARED by the live owner
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("p11"));
            ToolExecutionRecord v1 = repo.claimDispatch("p11", "owner-a", LEASE);
            ToolExecutionRecord v2 = cas(repo, v1, v1.withState(State.EXECUTING, false), "owner-a", 1);
            try {
                ToolExecutionRecord r = cas(repo, v2, v2.withState(State.PREPARED, false), "owner-a", 1);
                row("P11", "OPEN", "EXECUTING -> PREPARED accepted: " + d(r));
            } catch (Refused e) {
                row("P11", "closed", "backwards move refused (" + e.getMessage() + ")");
            }
        });
        guard("R1-9", () -> {                     // live owner moves lastSequence 5 -> 0
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("r19"));
            ToolExecutionRecord v1 = repo.claimDispatch("r19", "owner-a", LEASE);
            ToolExecutionRecord v2 = cas(repo, v1, rebuild(v1, State.EXECUTING, "owner-a",
                    v1.getDispatchLeaseUntil(), 1, 5, false), "owner-a", 1);
            try {
                ToolExecutionRecord v3 = cas(repo, v2, rebuild(v2, State.EXECUTING, "owner-a",
                        v2.getDispatchLeaseUntil(), 1, 0, false), "owner-a", 1);
                ToolExecutionRecord s = cas(repo, v3, v3.withResult(result("success"), 1, T0), "owner-a", 1);
                row("R1-9", "OPEN", "seq 5 -> 0 accepted, settled at seq " + s.getLastSequence());
            } catch (Refused e) {
                row("R1-9", "closed", "regression refused (" + e.getMessage() + ")");
            }
        });
        guard("R1-8", () -> {                     // AtomicLong inside a settled result
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("r18"));
            ToolExecutionRecord v1 = repo.claimDispatch("r18", "owner-a", LEASE);
            AtomicLong tokens = new AtomicLong(1);
            Map<String, Object> res = new HashMap<>();
            res.put("executionStatus", "success");
            res.put("tokens", tokens);
            ToolExecutionRecord settled;
            try {
                settled = cas(repo, v1, v1.withResult(res, 0, T0), "owner-a", 1);
            } catch (Refused | RuntimeException e) {
                row("R1-8", "closed", "mutable Number rejected (" + e.getMessage() + ")");
                return;
            }
            tokens.set(1000);
            Object after = repo.findByExecutionCallId("r18").getResult().get("tokens");
            row("R1-8", "OPEN", "settled " + d(settled) + ", result value after caller mutation = " + after);
        });
        guard("LIVE", () -> {                     // can an UNKNOWN execution ever be resolved?
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("live"));
            ToolExecutionRecord v1 = repo.claimDispatch("live", "owner-a", LEASE);
            cas(repo, v1, v1.withState(State.EXECUTING, false), "owner-a", 1);
            clock.adv(31);
            ToolExecutionRecord b = repo.claimDispatch("live", "owner-b", LEASE);
            ToolExecutionRecord cur = repo.findByExecutionCallId("live");
            if (cur.getState() != State.UNKNOWN) {   // head: takeover does not produce UNKNOWN
                cur = cas(repo, cur, cur.withUnknown(), b.getDispatchOwner(), b.getDispatchGeneration());
            }
            String how = "UNKNOWN " + d(cur);
            try {
                ToolExecutionRecord r = resolve(repo, "live", cur.getDispatchGeneration(), "owner-a",
                        clock.instant());
                row("LIVE", "ok", how + " -> resolved " + d(r) + "; session active="
                        + repo.hasActiveByRuntimeSession("session"));
            } catch (Refused e) {
                clock.adv(3600);
                row("LIVE", "STUCK", how + " -> resolution refused (" + e.getMessage()
                        + "); claim=" + d(repo.claimDispatch("live", "owner-c", LEASE))
                        + "; 1h later session active=" + repo.hasActiveByRuntimeSession("session"));
            }
        });
        guard("CTL", () -> {                      // positive controls that must keep working
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("ctl"));
            ToolExecutionRecord v1 = repo.claimDispatch("ctl", "owner-a", LEASE);
            ToolExecutionRecord v2 = cas(repo, v1, v1.withState(State.EXECUTING, false), "owner-a", 1);
            ToolExecutionRecord v3 = repo.renewDispatch("ctl", "owner-a", 1, LEASE);
            ToolExecutionRecord v4 = cancel(repo, "ctl");
            ToolExecutionRecord v5 = cas(repo, v4, v4.withResult(result("cancelled"), 0, T0), "owner-a", 1);
            boolean ok = v2 != null && v3 != null && v4.isCancelRequested() && v5.isSettled()
                    && !repo.hasActiveByRuntimeSession("session");
            row("CTL", ok ? "ok" : "BROKEN", "owner EXECUTING, renew, host cancel, owner settles "
                    + v5.getExecutionStatus() + "; session active=" + repo.hasActiveByRuntimeSession("session"));
        });
        guard("NOTE-sameRequest", () -> {
            Method m = ToolExecutionRecord.class.getDeclaredMethod("sameRequest", ToolExecutionRecord.class);
            boolean pub = java.lang.reflect.Modifier.isPublic(m.getModifiers());
            row("NOTE-sameRequest", pub ? "closed" : "OPEN", pub ? "public" : "package-private");
        });
        guard("NOTE-candidate-seq", () -> {
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            ToolExecutionRecord cand = new ToolExecutionRecord("cs", "key-cs", "binding", 1, "harness",
                    "session", "turn", "tool", "digest", ref(), State.PREPARED, null, null, 5, false,
                    null, null, 0, 0, null);
            try {
                repo.findOrCreate(cand);
                row("NOTE-candidate-seq", "OPEN", "PREPARED candidate with lastSequence=5 admitted");
            } catch (IllegalArgumentException e) {
                row("NOTE-candidate-seq", "closed", "refused (" + e.getMessage() + ")");
            }
        });
        guard("NOTE-ctor", () -> {
            boolean pub = false;
            for (java.lang.reflect.Constructor<?> c : ToolExecutionRecord.class.getDeclaredConstructors()) {
                if (c.getParameterCount() == 20 && java.lang.reflect.Modifier.isPublic(c.getModifiers())) {
                    pub = true;
                }
            }
            row("NOTE-ctor", pub ? "OPEN" : "closed", pub ? "20-arg constructor public" : "20-arg constructor not public");
        });
        guard("NOTE-map-key", () -> {
            Map<Object, Object> nested = new HashMap<>();
            nested.put(7, "x");
            Map<String, Object> reference = ref();
            reference.put("nested", nested);
            try {
                ToolExecutionRecord.prepared("mk", "key-mk", "binding", 1, "harness", "session", "turn",
                        "tool", "digest", reference);
                row("NOTE-map-key", "OPEN", "accepted");
            } catch (RuntimeException e) {
                row("NOTE-map-key", e instanceof IllegalArgumentException ? "closed" : "OPEN",
                        e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        });
    }
}
