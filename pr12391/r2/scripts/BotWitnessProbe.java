package probe.external;

import com.alibaba.qwen.code.runtimebroker.InMemoryToolExecutionRepository;
import com.alibaba.qwen.code.runtimebroker.ToolExecutionRecord;
import com.alibaba.qwen.code.runtimebroker.ToolExecutionRecord.State;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Re-runs every executed witness in the 12:28 bot review (R1-1..R1-9) through the
 * PUBLIC API only, from a package outside com.alibaba.qwen.code.runtimebroker.
 * Each block prints the observed values, then one line: claim / observed / verdict.
 */
public final class BotWitnessProbe {
    static final Instant T0 = Instant.parse("2026-09-21T00:00:00Z");
    static final Duration LEASE = Duration.ofSeconds(30);
    static int reproduced = 0;
    static int notReproduced = 0;

    static final class MClock extends Clock {
        Instant now = T0;
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
        void adv(long seconds) { now = now.plusSeconds(seconds); }
    }

    static Map<String, Object> ref(String digest) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("sessionId", "session");
        m.put("promptId", "turn");
        m.put("callId", "tool");
        m.put("argsDigest", digest);
        return m;
    }

    static ToolExecutionRecord prepared(String id, String key) {
        return ToolExecutionRecord.prepared(id, key, "binding", 1, "harness",
                "session", "turn", "tool", "digest", ref("digest"));
    }

    static Map<String, Object> result(String status) {
        return Map.of("executionStatus", status);
    }

    static String d(ToolExecutionRecord r) {
        if (r == null) {
            return "null";
        }
        return String.format("%s v%d owner=%s gen=%d cancel=%s seq=%d", r.getState(),
                r.getVersion(), r.getDispatchOwner(), r.getDispatchGeneration(),
                r.isCancelRequested(), r.getLastSequence());
    }

    /** Public 20-argument constructor, same identity/version, chosen claim fields. */
    static ToolExecutionRecord rebuild(ToolExecutionRecord r, State state, String owner,
            Instant lease, long generation, long lastSequence, boolean cancel) {
        return new ToolExecutionRecord(r.getExecutionCallId(), r.getIdempotencyKey(),
                r.getBindingId(), r.getRuntimeGeneration(), r.getHarnessSessionId(),
                r.getRuntimeSessionId(), r.getTurnId(), r.getToolCallId(),
                r.getRequestDigest(), r.getReference(), state, null, null, lastSequence,
                cancel, owner, lease, generation, r.getVersion(), null);
    }

    static void verdict(String id, String claim, boolean holds, String observed) {
        if (holds) {
            reproduced++;
        } else {
            notReproduced++;
        }
        System.out.printf("  => %s %-9s %s | observed: %s%n", id,
                holds ? "REPRODUCED" : "NOT-REPRO", claim, observed);
    }

    static String tryCas(InMemoryToolExecutionRepository repo, ToolExecutionRecord expected,
            ToolExecutionRecord replacement) {
        try {
            ToolExecutionRecord r = repo.compareAndSet(expected, replacement);
            return r == null ? "null" : "ACCEPTED " + d(r);
        } catch (RuntimeException e) {
            return "THREW " + e.getClass().getSimpleName() + ": " + e.getMessage();
        }
    }

    public static void main(String[] args) {
        System.out.println("java " + System.getProperty("java.version") + " / "
                + System.getProperty("java.vm.name") + " / " + System.getProperty("os.name")
                + " " + System.getProperty("os.arch"));
        r14();
        r15();
        r11();
        r13();
        r12();
        r18();
        r19();
        System.out.printf("%nSUMMARY reproduced=%d not-reproduced=%d%n", reproduced, notReproduced);
    }

    // R1-4: evicted owner re-reads and settles while B's lease is live.
    static void r14() {
        System.out.println("\n[R1-4] compareAndSet authenticates no actor");
        MClock clock = new MClock();
        InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
        repo.findOrCreate(prepared("exec-1", "key-1"));
        ToolExecutionRecord a = repo.claimDispatch("exec-1", "owner-a", LEASE);
        System.out.println("  t=0   A claimed   : " + d(a));
        clock.adv(31);
        ToolExecutionRecord b = repo.claimDispatch("exec-1", "owner-b", LEASE);
        System.out.println("  t=31  B took over : " + d(b));
        String ctl = tryCas(repo, a, a.withResult(result("error"), 0, clock.instant()));
        System.out.println("  CONTROL A stale-snapshot write -> " + ctl);
        clock.adv(1);
        ToolExecutionRecord aRe = repo.findByExecutionCallId("exec-1");
        boolean live = aRe.getDispatchLeaseUntil().isAfter(clock.instant());
        String w = tryCas(repo, aRe, aRe.withResult(result("error"), 0, clock.instant()));
        System.out.println("  t=32  A re-read (" + d(aRe) + "), B lease live=" + live
                + " ; A settles -> " + w);
        ToolExecutionRecord bRe = repo.findByExecutionCallId("exec-1");
        String bs = tryCas(repo, bRe, bRe.withState(State.EXECUTING, false));
        String bs2 = tryCas(repo, b, b.withResult(result("success"), 0, clock.instant()));
        boolean active = repo.hasActiveByRuntimeSession("session");
        ToolExecutionRecord byKey = repo.findByIdempotencyKey("key-1");
        System.out.println("  B writes after that -> " + bs + " / " + bs2
                + " ; hasActiveByRuntimeSession=" + active + " ; findByIdempotencyKey -> "
                + byKey.getExecutionStatus() + " " + byKey.getState());
        verdict("R1-4", "stale owner re-read+settle accepted, B locked out, session drains",
                ctl.equals("null") && live && w.startsWith("ACCEPTED SETTLED")
                        && bs.equals("null") && bs2.equals("null") && !active
                        && "error".equals(byKey.getExecutionStatus()),
                "ctl=" + ctl + "; settle=" + w.split(" ")[0] + "; active=" + active);
    }

    // R1-5: a replacement drops a live claim; second owner elected with no expiry.
    static void r15() {
        System.out.println("\n[R1-5] compareAndSet accepts a replacement that drops a live claim");
        MClock clock = new MClock();
        InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
        repo.findOrCreate(prepared("exec-5a", "key-5a"));
        ToolExecutionRecord v1 = repo.claimDispatch("exec-5a", "dispatcher-a", LEASE);
        ToolExecutionRecord v2 = repo.compareAndSet(v1, v1.withState(State.EXECUTING, false));
        clock.adv(5);
        ToolExecutionRecord drop = rebuild(v2, State.EXECUTING, null, null,
                v2.getDispatchGeneration(), v2.getLastSequence(), false);
        String s5 = tryCas(repo, v2, drop);
        ToolExecutionRecord s6 = repo.claimDispatch("exec-5a", "dispatcher-b", LEASE);
        long left = Duration.between(clock.instant(), v1.getDispatchLeaseUntil()).getSeconds();
        System.out.println("  route 1 (public ctor): CAS(claim-drop) at T0+5s -> " + s5);
        System.out.println("          claimDispatch(dispatcher-b) with " + left
                + "s of A's lease left -> " + d(s6));
        boolean route1 = s5.startsWith("ACCEPTED EXECUTING v3 owner=null gen=1")
                && s6 != null && "dispatcher-b".equals(s6.getDispatchOwner())
                && s6.getDispatchGeneration() == 2 && s6.getVersion() == 4 && left == 25;

        InMemoryToolExecutionRepository repo2 = new InMemoryToolExecutionRepository(new MClock());
        repo2.findOrCreate(prepared("exec-5b", "key-5b"));
        ToolExecutionRecord w1 = repo2.claimDispatch("exec-5b", "dispatcher-a", LEASE);
        ToolExecutionRecord w2 = repo2.compareAndSet(w1, w1.withUnknown());
        ToolExecutionRecord w3 = repo2.compareAndSet(w2, w2.withState(State.EXECUTING, false));
        ToolExecutionRecord w4 = repo2.claimDispatch("exec-5b", "dispatcher-b", LEASE);
        System.out.println("  route 2 (with*() only): withUnknown -> " + d(w2)
                + " ; withState(EXECUTING) -> " + d(w3) + " ; claim(b) -> " + d(w4));
        boolean route2 = w2 != null && w2.getState() == State.UNKNOWN && w2.getDispatchOwner() == null
                && w3 != null && w3.getState() == State.EXECUTING && w3.getVersion() == 3
                && w4 != null && "dispatcher-b".equals(w4.getDispatchOwner())
                && w4.getDispatchGeneration() == 2 && w4.getVersion() == 4;
        verdict("R1-5", "both routes elect a 2nd owner while A's lease is unexpired",
                route1 && route2, "route1=" + route1 + " route2=" + route2);
    }

    // R1-1: hand-built replacement regresses generation 3 -> 1; expired-lease settle.
    static void r11() {
        System.out.println("\n[R1-1] compareAndSet does not fence the claim fields");
        MClock clock = new MClock();
        InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
        repo.findOrCreate(prepared("exec-11", "key-11"));
        repo.claimDispatch("exec-11", "owner-a", LEASE);
        clock.adv(31);
        repo.claimDispatch("exec-11", "owner-b", LEASE);
        clock.adv(31);
        ToolExecutionRecord c = repo.claimDispatch("exec-11", "owner-c", LEASE);
        ToolExecutionRecord hijack = rebuild(c, c.getState(), "owner-a",
                clock.instant().plus(LEASE), 1, c.getLastSequence(), false);
        String k1a = tryCas(repo, c, hijack);
        ToolExecutionRecord rc = repo.renewDispatch("exec-11", "owner-c", 3, LEASE);
        ToolExecutionRecord ra = repo.renewDispatch("exec-11", "owner-a", 1, LEASE);
        System.out.println("  stored before: " + d(c) + " ; hijack CAS -> " + k1a);
        System.out.println("  renewDispatch(owner-c, gen=3) -> " + (rc == null ? "null" : "non-null")
                + " ; renewDispatch(owner-a, gen=1) -> " + (ra == null ? "null" : "non-null"));

        MClock clock2 = new MClock();
        InMemoryToolExecutionRepository repo2 = new InMemoryToolExecutionRepository(clock2);
        repo2.findOrCreate(prepared("exec-11b", "key-11b"));
        ToolExecutionRecord a = repo2.claimDispatch("exec-11b", "owner-a", LEASE);
        clock2.adv(31);
        String k1b = tryCas(repo2, a, a.withResult(result("success"), 0, clock2.instant()));
        System.out.println("  k1b: owner-a's lease expired 1s ago, nobody took over; settle -> " + k1b);
        verdict("R1-1", "generation regressed 3->1, two owners renew; expired owner settles",
                k1a.startsWith("ACCEPTED") && k1a.contains("owner=owner-a gen=1")
                        && rc == null && ra != null && k1b.startsWith("ACCEPTED SETTLED"),
                "k1a=" + k1a.split(" ")[0] + " rc=" + rc + " ra=" + (ra != null) + " k1b="
                        + k1b.split(" ")[0]);
    }

    // R1-3: UNKNOWN escape to PREPARED + re-claim; cancel flag erase; incoherent state.
    static void r13() {
        System.out.println("\n[R1-3] compareAndSet applies no transition policy");
        MClock clock = new MClock();
        InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
        repo.findOrCreate(prepared("exec-13", "key-13"));
        ToolExecutionRecord v1 = repo.claimDispatch("exec-13", "owner-a", LEASE);
        ToolExecutionRecord v2 = repo.compareAndSet(v1, v1.withUnknown());
        ToolExecutionRecord ctl = repo.claimDispatch("exec-13", "owner-b", LEASE);
        String esc = tryCas(repo, v2, v2.withState(State.PREPARED, false));
        ToolExecutionRecord re = repo.claimDispatch("exec-13", "owner-b", LEASE);
        System.out.println("  k3a: UNKNOWN " + d(v2) + " ; claim while UNKNOWN -> " + d(ctl)
                + " ; escape to PREPARED -> " + esc + " ; re-claim -> " + d(re));

        InMemoryToolExecutionRepository repo2 = new InMemoryToolExecutionRepository(new MClock());
        repo2.findOrCreate(prepared("exec-13b", "key-13b"));
        ToolExecutionRecord w1 = repo2.claimDispatch("exec-13b", "owner-a", LEASE);
        ToolExecutionRecord w2 = repo2.compareAndSet(w1, w1.withState(State.EXECUTING, false));
        ToolExecutionRecord w3 = repo2.compareAndSet(w2, w2.withState(State.CANCEL_REQUESTED, true));
        String erase = tryCas(repo2, w3, w3.withState(State.EXECUTING, false));
        System.out.println("  k3b1: " + d(w3) + " -> withState(EXECUTING,false) -> " + erase);

        MClock clock3 = new MClock();
        InMemoryToolExecutionRepository repo3 = new InMemoryToolExecutionRepository(clock3);
        repo3.findOrCreate(prepared("exec-13c", "key-13c"));
        ToolExecutionRecord x1 = repo3.claimDispatch("exec-13c", "owner-a", LEASE);
        String inc = tryCas(repo3, x1, x1.withState(State.CANCEL_REQUESTED, false));
        clock3.adv(31);
        ToolExecutionRecord x3 = repo3.claimDispatch("exec-13c", "owner-b", LEASE);
        System.out.println("  k3b2: withState(CANCEL_REQUESTED,false) -> " + inc
                + " ; after expiry claim(b) -> " + d(x3));
        verdict("R1-3", "UNKNOWN->PREPARED escape+re-claim; cancel erased; incoherent state accepted",
                v2.getState() == State.UNKNOWN && ctl == null
                        && esc.startsWith("ACCEPTED PREPARED") && re != null
                        && re.getDispatchGeneration() == 2
                        && erase.startsWith("ACCEPTED EXECUTING") && erase.contains("cancel=false")
                        && inc.startsWith("ACCEPTED CANCEL_REQUESTED") && inc.contains("cancel=false")
                        && x3 != null && x3.getState() == State.DISPATCHING,
                "k3a=" + esc.split(" ")[0] + " k3b1=" + erase.split(" ")[0] + " k3b2="
                        + inc.split(" ")[0] + "->" + (x3 == null ? null : x3.getState()));
    }

    // R1-2: expired-lease takeover of EXECUTING writes DISPATCHING; no dispatch evidence.
    static void r12() {
        System.out.println("\n[R1-2] claimDispatch rewrites EXECUTING to DISPATCHING on takeover");
        MClock clock = new MClock();
        InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
        repo.findOrCreate(prepared("exec-12", "key-12"));
        ToolExecutionRecord v1 = repo.claimDispatch("exec-12", "owner-a", LEASE);
        ToolExecutionRecord v2 = repo.compareAndSet(v1, v1.withState(State.EXECUTING, false));
        clock.adv(31);
        ToolExecutionRecord v3 = repo.claimDispatch("exec-12", "owner-b", LEASE);
        List<String> fields = new ArrayList<>();
        for (Field f : ToolExecutionRecord.class.getDeclaredFields()) {
            if (!Modifier.isStatic(f.getModifiers())) {
                fields.add(f.getName());
            }
        }
        boolean evidence = fields.stream().anyMatch(n -> n.toLowerCase().matches(
                ".*(attempt|dispatchedat|previous|prior|started).*"));
        System.out.println("  before expiry: " + d(v2) + " ; after takeover: " + d(v3));
        System.out.println("  instance fields: " + fields.size()
                + " ; any attempt/dispatchedAt/previous-owner field: " + evidence);

        MClock clockC = new MClock();
        InMemoryToolExecutionRepository repoC = new InMemoryToolExecutionRepository(clockC);
        repoC.findOrCreate(prepared("exec-12c", "key-12c"));
        ToolExecutionRecord c1 = repoC.claimDispatch("exec-12c", "owner-a", LEASE);
        ToolExecutionRecord c2 = repoC.compareAndSet(c1, c1.withState(State.EXECUTING, false));
        ToolExecutionRecord c3 = repoC.compareAndSet(c2, c2.withState(State.CANCEL_REQUESTED, true));
        clockC.adv(31);
        ToolExecutionRecord c4 = repoC.claimDispatch("exec-12c", "owner-b", LEASE);
        System.out.println("  control (cancelRequested=true): " + d(c3) + " -> takeover -> " + d(c4));
        verdict("R1-2", "EXECUTING -> DISPATCHING on takeover, 20 fields, no dispatch evidence",
                v2.getState() == State.EXECUTING && v3.getState() == State.DISPATCHING
                        && v3.getDispatchGeneration() == 2 && fields.size() == 20 && !evidence
                        && c4.getState() == State.CANCEL_REQUESTED,
                v2.getState() + "->" + v3.getState() + ", fields=" + fields.size()
                        + ", control->" + c4.getState());
    }

    // R1-8: mutable Number aliasing inside a settled result; rebuilt reference unequal.
    static void r18() {
        System.out.println("\n[R1-8] immutableValue keeps any Number by reference");
        MClock clock = new MClock();
        InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
        repo.findOrCreate(prepared("exec-18", "key-18"));
        ToolExecutionRecord v1 = repo.claimDispatch("exec-18", "owner-a", LEASE);
        AtomicLong tokens = new AtomicLong(1);
        Map<String, Object> res = new HashMap<>();
        res.put("executionStatus", "success");
        res.put("tokens", tokens);
        ToolExecutionRecord settled = repo.compareAndSet(v1, v1.withResult(res, 0, clock.instant()));
        Object before = settled.getResult().get("tokens");
        long beforeVal = ((Number) before).longValue();
        boolean alias = before == tokens;
        tokens.set(1000);
        ToolExecutionRecord reread = repo.findByExecutionCallId("exec-18");
        long after = ((Number) reread.getResult().get("tokens")).longValue();
        boolean writable;
        try {
            reread.getResult().put("x", 1);
            writable = true;
        } catch (UnsupportedOperationException e) {
            writable = false;
        }
        System.out.println("  settled " + d(settled) + " ; tokens before=" + beforeVal
                + " alias-of-caller-object=" + alias + " ; after caller mutates: " + after
                + " (version " + reread.getVersion() + ") ; map writable=" + writable);

        Map<String, Object> refA = ref("digest");
        refA.put("budget", new AtomicLong(5));
        InMemoryToolExecutionRepository repo2 = new InMemoryToolExecutionRepository(new MClock());
        repo2.findOrCreate(ToolExecutionRecord.prepared("exec-18b", "key-18b", "binding", 1,
                "harness", "session", "turn", "tool", "digest", refA));
        ToolExecutionRecord b1 = repo2.claimDispatch("exec-18b", "owner-a", LEASE);
        Map<String, Object> refB = ref("digest");
        refB.put("budget", new AtomicLong(5));
        ToolExecutionRecord rebuilt = new ToolExecutionRecord(b1.getExecutionCallId(),
                b1.getIdempotencyKey(), "binding", 1, "harness", "session", "turn", "tool",
                "digest", refB, State.EXECUTING, null, null, 0, false, b1.getDispatchOwner(),
                b1.getDispatchLeaseUntil(), b1.getDispatchGeneration(), b1.getVersion(), null);
        String atomicCas = tryCas(repo2, b1, rebuilt);

        Map<String, Object> refL = ref("digest");
        refL.put("budget", 5L);
        InMemoryToolExecutionRepository repo3 = new InMemoryToolExecutionRepository(new MClock());
        repo3.findOrCreate(ToolExecutionRecord.prepared("exec-18c", "key-18c", "binding", 1,
                "harness", "session", "turn", "tool", "digest", refL));
        ToolExecutionRecord l1 = repo3.claimDispatch("exec-18c", "owner-a", LEASE);
        Map<String, Object> refL2 = ref("digest");
        refL2.put("budget", 5L);
        ToolExecutionRecord rebuiltL = new ToolExecutionRecord(l1.getExecutionCallId(),
                l1.getIdempotencyKey(), "binding", 1, "harness", "session", "turn", "tool",
                "digest", refL2, State.EXECUTING, null, null, 0, false, l1.getDispatchOwner(),
                l1.getDispatchLeaseUntil(), l1.getDispatchGeneration(), l1.getVersion(), null);
        String longCas = tryCas(repo3, l1, rebuiltL);
        String legitPath = tryCas(repo2, b1, b1.withState(State.EXECUTING, false));
        System.out.println("  rebuilt-from-identical-values CAS: AtomicLong -> " + atomicCas);
        System.out.println("                                     Long (control) -> " + longCas);
        System.out.println("  same record via withState() (reuses the stored instance) -> " + legitPath);
        verdict("R1-8", "caller mutates a settled result; rebuilt AtomicLong identity refused",
                alias && beforeVal == 1 && after == 1000 && reread.getVersion() == 2 && !writable
                        && atomicCas.startsWith("THREW IllegalArgumentException")
                        && longCas.startsWith("ACCEPTED") && legitPath.startsWith("ACCEPTED"),
                "after=" + after + " atomicCas=" + atomicCas.split(":")[0] + " longCas="
                        + longCas.split(" ")[0]);
    }

    // R1-9: lastSequence regression 5 -> 0 through compareAndSet.
    static void r19() {
        System.out.println("\n[R1-9] compareAndSet lets lastSequence move backwards");
        MClock clock = new MClock();
        InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
        ToolExecutionRecord cand = new ToolExecutionRecord("exec-19", "key-19", "binding", 1,
                "harness", "session", "turn", "tool", "digest", ref("digest"), State.PREPARED,
                null, null, 5, false, null, null, 0, 0, null);
        ToolExecutionRecord s1 = repo.findOrCreate(cand);
        ToolExecutionRecord s2 = repo.claimDispatch("exec-19", "owner-a", LEASE);
        String ctl;
        try {
            s2.withResult(result("success"), 1, clock.instant());
            ctl = "no throw";
        } catch (IllegalArgumentException e) {
            ctl = "throws: " + e.getMessage();
        }
        ToolExecutionRecord regress = rebuild(s2, s2.getState(), s2.getDispatchOwner(),
                s2.getDispatchLeaseUntil(), s2.getDispatchGeneration(), 0, false);
        String s3 = tryCas(repo, s2, regress);
        ToolExecutionRecord cur = repo.findByExecutionCallId("exec-19");
        String s4 = tryCas(repo, cur, cur.withResult(result("success"), 1, clock.instant()));
        System.out.println("  STEP1 findOrCreate -> " + d(s1) + " ; STEP2 claim -> " + d(s2));
        System.out.println("  CONTROL withResult(seq=1) on seq=5 -> " + ctl);
        System.out.println("  STEP3 CAS(seq 5 -> 0) -> " + s3 + " ; STEP4 settle seq=1 -> " + s4);
        verdict("R1-9", "seq regressed 5->0, then settles at 1 although 5 was recorded",
                s1.getLastSequence() == 5 && ctl.startsWith("throws") && s3.startsWith("ACCEPTED")
                        && s3.contains("seq=0") && s4.startsWith("ACCEPTED SETTLED")
                        && s4.contains("seq=1"),
                "s3=" + s3.split(" ")[0] + " s4=" + s4.split(" ")[0]);
    }
}
