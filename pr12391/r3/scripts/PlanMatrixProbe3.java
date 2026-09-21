package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.qwen.code.runtimebroker.ToolExecutionRecord.State;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
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
 * Round-3 matrix. Lives in the module package (clause-level). Arm-specific API is reached by
 * reflection: 2-arg or 4-arg compareAndSet, requestCancel(id[, version]), resolveUnknown
 * (repository, any signature). A caller always writes with the snapshot it actually has; where the
 * arm's CAS takes an actor, the caller passes ITS OWN identity (owner id + generation it claimed).
 */
public final class PlanMatrixProbe3 {
    static final Instant T0 = Instant.parse("2026-09-21T00:00:00Z");
    static final Duration LEASE = Duration.ofSeconds(30);
    static Method cas2;
    static Method cas4;
    static Method cancel1;
    static Method cancel2;
    static Method resolveSnap;
    static Method resolveGen;

    static final class MClock extends Clock {
        Instant now = T0;
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
        void adv(long s) { now = now.plusSeconds(s); }
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
            Instant lease, long gen, long seq, boolean cancel) {
        return new ToolExecutionRecord(r.getExecutionCallId(), r.getIdempotencyKey(),
                r.getBindingId(), r.getRuntimeGeneration(), r.getHarnessSessionId(),
                r.getRuntimeSessionId(), r.getTurnId(), r.getToolCallId(), r.getRequestDigest(),
                r.getReference(), state, null, null, seq, cancel, owner, lease, gen,
                r.getVersion(), null);
    }

    static Object call(Method m, Object target, Object... args) throws Refused {
        try {
            return m.invoke(target, args);
        } catch (InvocationTargetException e) {
            throw new Refused("threw " + e.getCause().getClass().getSimpleName() + ": "
                    + e.getCause().getMessage());
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        }
    }

    static ToolExecutionRecord nn(Object o) throws Refused {
        if (o == null) {
            throw new Refused("null");
        }
        return (ToolExecutionRecord) o;
    }

    /** Write as actor (owner, gen) with the snapshot "expected". */
    static ToolExecutionRecord cas(InMemoryToolExecutionRepository repo, ToolExecutionRecord expected,
            ToolExecutionRecord replacement, String owner, long gen) throws Refused {
        return nn(cas4 != null ? call(cas4, repo, expected, replacement, owner, gen)
                : call(cas2, repo, expected, replacement));
    }

    static ToolExecutionRecord cancel(InMemoryToolExecutionRepository repo, String id) throws Refused {
        ToolExecutionRecord cur = repo.findByExecutionCallId(id);
        if (cancel2 != null) {
            return nn(call(cancel2, repo, id, cur.getVersion()));
        }
        if (cancel1 != null) {
            return nn(call(cancel1, repo, id));
        }
        State next = cur.getState() == State.DISPATCHING || cur.getState() == State.EXECUTING
                ? State.CANCEL_REQUESTED : cur.getState();
        return cas(repo, cur, cur.withState(next, true), "host", 0);
    }

    static ToolExecutionRecord resolve(InMemoryToolExecutionRepository repo, String id, Instant now)
            throws Refused {
        ToolExecutionRecord cur = repo.findByExecutionCallId(id);
        if (resolveSnap != null) {
            return nn(call(resolveSnap, repo, cur, result("success"), now));
        }
        if (resolveGen != null) {
            return nn(call(resolveGen, repo, id, cur.getDispatchGeneration(), result("success"), now));
        }
        return cas(repo, cur, cur.resolveUnknown(result("success"), now), cur.getDispatchOwner(),
                cur.getDispatchGeneration());
    }

    static String d(ToolExecutionRecord r) {
        return r == null ? "null" : r.getState() + " v" + r.getVersion() + " owner="
                + r.getDispatchOwner() + " gen=" + r.getDispatchGeneration()
                + (r.isCancelRequested() ? " cancel" : "") + " seq=" + r.getLastSequence()
                + (r.getExecutionStatus() != null ? " status=" + r.getExecutionStatus() : "");
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

    public static void main(String[] args) {
        for (Method m : InMemoryToolExecutionRepository.class.getMethods()) {
            int n = m.getParameterCount();
            switch (m.getName()) {
                case "compareAndSet" -> { if (n == 4) { cas4 = m; } else if (n == 2) { cas2 = m; } }
                case "requestCancel" -> { if (n == 2) { cancel2 = m; } else if (n == 1) { cancel1 = m; } }
                case "resolveUnknown" -> {
                    if (n == 3) { resolveSnap = m; } else if (n == 4) { resolveGen = m; }
                }
                default -> { }
            }
        }
        System.out.println("#arm\t" + args[0] + "\tcas=" + (cas4 != null ? "actor-4arg" : "")
                + (cas2 != null ? " snapshot-2arg" : "") + " requestCancel="
                + (cancel2 != null ? "(id,version)" : cancel1 != null ? "(id)" : "none")
                + " resolveUnknown=" + (resolveSnap != null ? "(snapshot)" : resolveGen != null
                        ? "(id,gen)" : "none") + " java=" + System.getProperty("java.version"));

        // ---------------- who may write
        guard("P1", () -> {       // a caller that never claimed reads the record and settles it
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("p1"));
            repo.claimDispatch("p1", "owner-a", LEASE);
            ToolExecutionRecord cur = repo.findByExecutionCallId("p1");
            try {
                ToolExecutionRecord r = cas(repo, cur, cur.withResult(result("error"), 0, T0), "stranger", 0);
                row("P1", "OPEN", "stranger settled during owner-a's live lease: " + d(r));
            } catch (Refused e) {
                row("P1", "closed", "stranger refused (" + e.getMessage() + ")");
            }
        });
        guard("R1-4", () -> {     // evicted owner re-reads (standard CAS retry) and settles
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("r14"));
            ToolExecutionRecord a = repo.claimDispatch("r14", "owner-a", LEASE);
            clock.adv(31);
            repo.claimDispatch("r14", "owner-b", LEASE);
            clock.adv(1);
            String own;
            try {
                cas(repo, a, a.withResult(result("error"), 0, clock.instant()), "owner-a", 1);
                own = "own old snapshot ACCEPTED";
            } catch (Refused e) {
                own = "own old snapshot refused (" + e.getMessage() + ")";
            }
            ToolExecutionRecord reread = repo.findByExecutionCallId("r14");
            try {
                ToolExecutionRecord r = cas(repo, reread, reread.withResult(result("error"), 0,
                        clock.instant()), "owner-a", 1);
                ToolExecutionRecord now = repo.findByExecutionCallId("r14");
                String b;
                try {
                    b = "B settles: " + d(cas(repo, now, now.withResult(result("success"), 0,
                            clock.instant()), "owner-b", 2));
                } catch (Refused e) {
                    b = "B refused (" + e.getMessage() + ")";
                }
                row("R1-4", "OPEN", own + "; after re-read A settled " + d(r) + "; " + b
                        + "; session active=" + repo.hasActiveByRuntimeSession("session"));
            } catch (Refused e) {
                row("R1-4", "closed", own + "; after re-read A refused (" + e.getMessage() + ")");
            }
        });
        guard("SYNTH", () -> {    // the new test's case: owner-a's claim spliced into the current version
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("syn"));
            ToolExecutionRecord a = repo.claimDispatch("syn", "owner-a", LEASE);
            clock.adv(31);
            ToolExecutionRecord b = repo.claimDispatch("syn", "owner-b", LEASE);
            ToolExecutionRecord spliced = b.withDispatch("owner-a", a.getDispatchLeaseUntil(),
                    a.getDispatchGeneration(), b.getState());
            try {
                cas(repo, spliced, spliced.withResult(result("error"), 0, clock.instant()), "owner-a", 1);
                row("SYNTH", "OPEN", "spliced stale claim at current version accepted");
            } catch (Refused e) {
                row("SYNTH", "closed", "spliced stale claim refused (" + e.getMessage() + ")");
            }
        });
        guard("R1-1b", () -> {    // owner whose lease expired settles, nobody took over
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
        guard("FORCE-UNKNOWN", () -> {  // a reader forces a live execution into UNKNOWN
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("fu"));
            ToolExecutionRecord a = repo.claimDispatch("fu", "owner-a", LEASE);
            ToolExecutionRecord ex = cas(repo, a, a.withState(State.EXECUTING, false), "owner-a", 1);
            ToolExecutionRecord cur = repo.findByExecutionCallId("fu");
            try {
                ToolExecutionRecord u = cas(repo, cur, cur.withUnknown(), "stranger", 0);
                String own;
                try {
                    cas(repo, ex, ex.withResult(result("success"), 0, T0), "owner-a", 1);
                    own = "owner-a can still settle";
                } catch (Refused e) {
                    own = "owner-a's own settle then refused (" + e.getMessage() + ")";
                }
                row("FORCE-UNKNOWN", "OPEN", "stranger moved the live execution to " + d(u) + "; " + own);
            } catch (Refused e) {
                row("FORCE-UNKNOWN", "closed", "stranger refused (" + e.getMessage() + ")");
            }
        });
        guard("REWIND", () -> {   // a reader rewinds a running execution; after expiry it is dispatched again
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("rw"));
            ToolExecutionRecord a = repo.claimDispatch("rw", "owner-a", LEASE);
            cas(repo, a, a.withState(State.EXECUTING, false), "owner-a", 1);
            ToolExecutionRecord cur = repo.findByExecutionCallId("rw");
            try {
                cas(repo, cur, cur.withState(State.PREPARED, false), "stranger", 0);
            } catch (Refused e) {
                row("REWIND", "closed", "stranger's rewind refused (" + e.getMessage() + ")");
                return;
            }
            clock.adv(31);
            ToolExecutionRecord b = repo.claimDispatch("rw", "owner-b", LEASE);
            row("REWIND", b != null && b.getState() == State.DISPATCHING ? "OPEN" : "closed",
                    "stranger rewound EXECUTING -> PREPARED; after A's lease expired claim(b)=" + d(b));
        });
        // ---------------- which transitions are allowed
        guard("R1-2", () -> {
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("k2"));
            ToolExecutionRecord a = repo.claimDispatch("k2", "owner-a", LEASE);
            cas(repo, a, a.withState(State.EXECUTING, false), "owner-a", 1);
            clock.adv(31);
            ToolExecutionRecord b = repo.claimDispatch("k2", "owner-b", LEASE);
            ToolExecutionRecord now = repo.findByExecutionCallId("k2");
            row("R1-2", b != null && b.getState() == State.DISPATCHING ? "OPEN" : "closed",
                    "takeover of EXECUTING -> claim(b)=" + d(b) + "; stored " + d(now));
        });
        guard("R1-5b", () -> {    // UNKNOWN (lease holder's own), resume EXECUTING, 2nd claim
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("r15b"));
            ToolExecutionRecord a = repo.claimDispatch("r15b", "owner-a", LEASE);
            ToolExecutionRecord u = cas(repo, a, a.withUnknown(), "owner-a", 1);
            String resume;
            try {
                resume = "resume accepted " + d(cas(repo, u, u.withState(State.EXECUTING, false), "owner-a", 1));
            } catch (Refused e) {
                resume = "resume refused (" + e.getMessage() + ")";
            }
            ToolExecutionRecord b = repo.claimDispatch("r15b", "dispatcher-b", LEASE);
            row("R1-5b", b != null ? "OPEN" : resume.startsWith("resume accepted") ? "OPEN" : "closed",
                    resume + "; claim(b)=" + d(b));
        });
        guard("R1-3a", () -> {    // UNKNOWN -> PREPARED
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("k3a"));
            ToolExecutionRecord a = repo.claimDispatch("k3a", "owner-a", LEASE);
            ToolExecutionRecord u = cas(repo, a, a.withUnknown(), "owner-a", 1);
            try {
                cas(repo, u, u.withState(State.PREPARED, false), "owner-a", 1);
                row("R1-3a", "OPEN", "UNKNOWN escaped to PREPARED");
            } catch (Refused e) {
                row("R1-3a", "closed", "escape refused (" + e.getMessage() + ")");
            }
        });
        guard("R1-3b1", () -> {   // host cancel, then the owner erases it
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("k3b"));
            ToolExecutionRecord a = repo.claimDispatch("k3b", "owner-a", LEASE);
            cas(repo, a, a.withState(State.EXECUTING, false), "owner-a", 1);
            ToolExecutionRecord c = cancel(repo, "k3b");
            try {
                ToolExecutionRecord r = cas(repo, c, c.withState(State.EXECUTING, false), "owner-a", 1);
                row("R1-3b1", "OPEN", "cancel intent erased: " + d(r));
            } catch (Refused e) {
                row("R1-3b1", "closed", "erase refused (" + e.getMessage() + ")");
            }
        });
        guard("P11", () -> {      // EXECUTING -> PREPARED by the live owner
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("p11"));
            ToolExecutionRecord a = repo.claimDispatch("p11", "owner-a", LEASE);
            ToolExecutionRecord ex = cas(repo, a, a.withState(State.EXECUTING, false), "owner-a", 1);
            try {
                ToolExecutionRecord r = cas(repo, ex, ex.withState(State.PREPARED, false), "owner-a", 1);
                ToolExecutionRecord b = repo.claimDispatch("p11", "owner-b", LEASE);
                row("P11", "OPEN", "EXECUTING -> PREPARED accepted: " + d(r) + "; claim(b) while A's lease is live = " + d(b));
            } catch (Refused e) {
                row("P11", "closed", "backwards move refused (" + e.getMessage() + ")");
            }
        });
        // ---------------- what a write may carry
        guard("R1-5a", () -> {
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("r15a"));
            ToolExecutionRecord a = repo.claimDispatch("r15a", "dispatcher-a", LEASE);
            ToolExecutionRecord ex = cas(repo, a, a.withState(State.EXECUTING, false), "dispatcher-a", 1);
            try {
                cas(repo, ex, rebuild(ex, State.EXECUTING, null, null, 1, 0, false), "dispatcher-a", 1);
                ToolExecutionRecord b = repo.claimDispatch("r15a", "dispatcher-b", LEASE);
                row("R1-5a", b != null ? "OPEN" : "closed", "claim drop accepted; claim(b)=" + d(b));
            } catch (Refused e) {
                row("R1-5a", "closed", "claim drop refused (" + e.getMessage() + ")");
            }
        });
        guard("R1-1a", () -> {
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("k1a"));
            repo.claimDispatch("k1a", "owner-a", LEASE);
            clock.adv(31);
            repo.claimDispatch("k1a", "owner-b", LEASE);
            clock.adv(31);
            ToolExecutionRecord c = repo.claimDispatch("k1a", "owner-c", LEASE);
            try {
                cas(repo, c, rebuild(c, c.getState(), "owner-a", clock.instant().plus(LEASE), 1, 0, false),
                        "owner-c", 3);
                row("R1-1a", "OPEN", "generation regressed 3 -> 1");
            } catch (Refused e) {
                row("R1-1a", "closed", "claim rewrite refused (" + e.getMessage() + ")");
            }
        });
        guard("R1-9", () -> {
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("r19"));
            ToolExecutionRecord a = repo.claimDispatch("r19", "owner-a", LEASE);
            ToolExecutionRecord v2 = cas(repo, a, rebuild(a, State.EXECUTING, "owner-a",
                    a.getDispatchLeaseUntil(), 1, 5, false), "owner-a", 1);
            try {
                ToolExecutionRecord v3 = cas(repo, v2, rebuild(v2, State.EXECUTING, "owner-a",
                        v2.getDispatchLeaseUntil(), 1, 0, false), "owner-a", 1);
                ToolExecutionRecord s = cas(repo, v3, v3.withResult(result("success"), 1, T0), "owner-a", 1);
                row("R1-9", "OPEN", "lastSequence 5 -> 0 accepted, settled at " + s.getLastSequence());
            } catch (Refused e) {
                row("R1-9", "closed", "regression refused (" + e.getMessage() + ")");
            }
        });
        guard("R1-8", () -> {
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("r18"));
            ToolExecutionRecord a = repo.claimDispatch("r18", "owner-a", LEASE);
            AtomicLong tokens = new AtomicLong(1);
            Map<String, Object> res = new HashMap<>();
            res.put("executionStatus", "success");
            res.put("tokens", tokens);
            try {
                cas(repo, a, a.withResult(res, 0, T0), "owner-a", 1);
            } catch (Refused | RuntimeException e) {
                row("R1-8", "closed", "mutable Number rejected (" + e.getMessage() + ")");
                return;
            }
            tokens.set(1000);
            row("R1-8", "OPEN", "stored result value after caller mutation = "
                    + repo.findByExecutionCallId("r18").getResult().get("tokens"));
        });
        guard("R1-3b2", () -> {
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("k3c"));
            ToolExecutionRecord a = repo.claimDispatch("k3c", "owner-a", LEASE);
            ToolExecutionRecord inc;
            try {
                inc = a.withState(State.CANCEL_REQUESTED, false);
            } catch (RuntimeException e) {
                row("R1-3b2", "closed", "incoherent record not constructible");
                return;
            }
            try {
                ToolExecutionRecord r = cas(repo, a, inc, "owner-a", 1);
                row("R1-3b2", "stored", "CANCEL_REQUESTED/cancelRequested=false stored: " + d(r)
                        + " (takeover now yields UNKNOWN, so the old DISPATCHING rewrite is gone)");
            } catch (Refused e) {
                row("R1-3b2", "closed", "incoherent write refused (" + e.getMessage() + ")");
            }
        });
        // ---------------- UNKNOWN lifecycle
        guard("OWN-UNKNOWN", () -> {
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            repo.findOrCreate(prepared("own"));
            ToolExecutionRecord a = repo.claimDispatch("own", "owner-a", LEASE);
            ToolExecutionRecord ex = cas(repo, a, a.withState(State.EXECUTING, false), "owner-a", 1);
            try {
                ToolExecutionRecord u = cas(repo, ex, ex.withUnknown(), "owner-a", 1);
                ToolExecutionRecord r = resolve(repo, "own", T0);
                row("OWN-UNKNOWN", "ok", "lease holder recorded " + d(u) + " -> resolved " + d(r)
                        + "; active=" + repo.hasActiveByRuntimeSession("session"));
            } catch (Refused e) {
                row("OWN-UNKNOWN", "BLOCKED", "refused (" + e.getMessage() + ")");
            }
        });
        guard("LIVE", () -> {     // takeover UNKNOWN, resolved an hour later
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("live"));
            ToolExecutionRecord a = repo.claimDispatch("live", "owner-a", LEASE);
            cas(repo, a, a.withState(State.EXECUTING, false), "owner-a", 1);
            clock.adv(31);
            repo.claimDispatch("live", "owner-b", LEASE);
            ToolExecutionRecord u = repo.findByExecutionCallId("live");
            if (u.getState() != State.UNKNOWN) {
                row("LIVE", "n/a", "takeover gave " + d(u) + " (no UNKNOWN on this arm)");
                return;
            }
            clock.adv(3600);
            try {
                ToolExecutionRecord r = resolve(repo, "live", clock.instant());
                row("LIVE", u.getState() == State.UNKNOWN ? "ok" : "n/a",
                        "takeover gave " + d(u) + " -> resolved 1 h later " + d(r) + "; active="
                                + repo.hasActiveByRuntimeSession("session"));
            } catch (Refused e) {
                row("LIVE", "STUCK", "takeover gave " + d(u) + " -> resolution refused (" + e.getMessage() + ")");
            }
        });
        // ---------------- controls
        guard("CTL", () -> {
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            repo.findOrCreate(prepared("ctl"));
            ToolExecutionRecord a = repo.claimDispatch("ctl", "owner-a", LEASE);
            ToolExecutionRecord ex = cas(repo, a, a.withState(State.EXECUTING, false), "owner-a", 1);
            ToolExecutionRecord rn = nn(repo.renewDispatch("ctl", "owner-a", 1, LEASE));
            ToolExecutionRecord c = cancel(repo, "ctl");
            ToolExecutionRecord s = cas(repo, c, c.withResult(result("cancelled"), 0, T0), "owner-a", 1);
            repo.findOrCreate(prepared("ctl2"));
            ToolExecutionRecord pc = cancel(repo, "ctl2");
            boolean ok = ex != null && rn != null && c.isCancelRequested() && s.isSettled();
            row("CTL", ok ? "ok" : "BROKEN", "claim, EXECUTING, renew, host cancel -> " + c.getState()
                    + ", owner settles " + s.getExecutionStatus() + "; cancel on PREPARED -> " + d(pc)
                    + "; active=" + repo.hasActiveByRuntimeSession("session"));
        });
        // ---------------- notes
        guard("NOTE-sameRequest", () -> {
            Method m = ToolExecutionRecord.class.getDeclaredMethod("sameRequest", ToolExecutionRecord.class);
            row("NOTE-sameRequest", Modifier.isPublic(m.getModifiers()) ? "closed" : "OPEN",
                    Modifier.isPublic(m.getModifiers()) ? "public" : "package-private");
        });
        guard("NOTE-candidate-seq", () -> {
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(new MClock());
            ToolExecutionRecord cand = new ToolExecutionRecord("cs", "key-cs", "binding", 1, "harness",
                    "session", "turn", "tool", "digest", ref(), State.PREPARED, null, null, 5, false,
                    null, null, 0, 0, null);
            try {
                repo.findOrCreate(cand);
                row("NOTE-candidate-seq", "OPEN", "candidate with lastSequence=5 admitted");
            } catch (IllegalArgumentException e) {
                row("NOTE-candidate-seq", "closed", "refused");
            }
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
                        e.getClass().getSimpleName());
            }
        });
        guard("NOTE-ctor", () -> {
            boolean pub = false;
            for (java.lang.reflect.Constructor<?> c : ToolExecutionRecord.class.getDeclaredConstructors()) {
                if (c.getParameterCount() == 20 && Modifier.isPublic(c.getModifiers())) {
                    pub = true;
                }
            }
            row("NOTE-ctor", pub ? "OPEN" : "closed", pub ? "20-arg constructor public" : "not public");
        });
    }
}
