// P2 (rig-only): measure the natural insert->claim race without widening.
//  U: scanner live for the whole loop (pre-PR behaviour)
//  P: paused once for the whole loop (PR behaviour inside a paused test)
//  T: available=true -> pause -> insert -> claim, every iteration (the pause
//     boundary; exercises the in-flight-scan residual raised in #13031 triage)
// Also instruments HarnessCoordinator.recoverExpiredTurns: gap between the
// isAvailable() check and findDispatchable() returning.
import fs from 'node:fs';
const root = process.argv[2] + '/packages/sdk-java/managed-agent-server/src/';
const hc = root + 'main/java/com/alibaba/qwen/code/managedagent/service/HarnessCoordinator.java';
let h = fs.readFileSync(hc, 'utf8');
const scanOld = `        if (!harness.isAvailable()) {
            return;
        }
        for (DispatchTarget target : store.findDispatchable(clock.millis(),
                50)) {
            dispatch(target.tenantId(), target.sessionId(), target.turnId());
        }`;
const scanNew = `        if (!harness.isAvailable()) {
            return;
        }
        long probeStart = System.nanoTime();
        List<DispatchTarget> probeTargets = store.findDispatchable(
                clock.millis(), 50);
        long probeGap = System.nanoTime() - probeStart;
        PROBE_SCANS.incrementAndGet();
        PROBE_MAX_GAP_NS.accumulateAndGet(probeGap, Math::max);
        if (probeGap > 1_000_000L) {
            PROBE_GAPS_OVER_1MS.incrementAndGet();
        }
        for (DispatchTarget target : probeTargets) {
            dispatch(target.tenantId(), target.sessionId(), target.turnId());
        }`;
if (!h.includes(scanOld)) throw new Error('scan anchor missing');
h = h.replace(scanOld, scanNew);
h = h.replace('public class HarnessCoordinator {', `public class HarnessCoordinator {
    public static final java.util.concurrent.atomic.AtomicLong PROBE_SCANS =
            new java.util.concurrent.atomic.AtomicLong();
    public static final java.util.concurrent.atomic.AtomicLong PROBE_MAX_GAP_NS =
            new java.util.concurrent.atomic.AtomicLong();
    public static final java.util.concurrent.atomic.AtomicLong PROBE_GAPS_OVER_1MS =
            new java.util.concurrent.atomic.AtomicLong();`);
fs.writeFileSync(hc, h);

const tf = root + 'test/java/com/alibaba/qwen/code/managedagent/ManagedAgentServerIntegrationTest.java';
let t = fs.readFileSync(tf, 'utf8');
const anchor = '    @Test\n    void allowsRepeatingLifecycleOperationsWithNewCommandKeys() {';
if (!t.includes(anchor)) throw new Error('test anchor missing');
const probe = `    private static final int PROBE_ITERATIONS = 20_000;

    @Test
    void probeNaturalRaceUnpaused() {
        probeNaturalRace("U");
    }

    @Test
    void probeNaturalRacePaused() {
        probeNaturalRace("P");
    }

    @Test
    void probeNaturalRaceTogglePerIteration() {
        probeNaturalRace("T");
    }

    private void probeNaturalRace(String mode) {
        if ("P".equals(mode)) {
            pauseRecoveryScanning();
        }
        long scansBefore = HarnessCoordinator.PROBE_SCANS.get();
        HarnessCoordinator.PROBE_MAX_GAP_NS.set(0);
        HarnessCoordinator.PROBE_GAPS_OVER_1MS.set(0);
        long[] pauseToInsert = new long[PROBE_ITERATIONS];
        int lost = 0;
        long started = System.nanoTime();
        for (int i = 0; i < PROBE_ITERATIONS; i++) {
            long pausedAt = System.nanoTime();
            if ("T".equals(mode)) {
                harness.setAvailable(true);
                pausedAt = System.nanoTime();
                pauseRecoveryScanning();
            }
            String tenant = "tenant-probe-" + mode + "-" + UUID.randomUUID();
            Admission session = store.insertSessionCommand(tenant,
                    "CREATE_SESSION", "probe-create",
                    "sha256:" + "1".repeat(64), "qwen-code", null, null,
                    List.of(), null);
            Admission turn = store.insertTurnCommand(tenant, "SUBMIT_TURN",
                    "probe-turn", "sha256:" + "2".repeat(64),
                    session.sessionId(), List.of(),
                    "sha256:" + "3".repeat(64));
            pauseToInsert[i] = System.nanoTime() - pausedAt;
            if (store.claimTurn(tenant, session.sessionId(), turn.turnId(),
                    "probe-owner", Duration.ofMinutes(1)).isEmpty()) {
                lost++;
            }
        }
        long elapsed = System.nanoTime() - started;
        java.util.Arrays.sort(pauseToInsert);
        System.out.println("PROBE-P2 mode=" + mode + " iterations="
                + PROBE_ITERATIONS + " lostClaims=" + lost + " elapsedMs="
                + TimeUnit.NANOSECONDS.toMillis(elapsed)
                + " scansThatQueried="
                + (HarnessCoordinator.PROBE_SCANS.get() - scansBefore)
                + " maxCheckToQueryUs="
                + HarnessCoordinator.PROBE_MAX_GAP_NS.get() / 1000
                + " checkToQueryOver1ms="
                + HarnessCoordinator.PROBE_GAPS_OVER_1MS.get()
                + " pauseToTurnCommittedUs(min/p50/p99)="
                + pauseToInsert[0] / 1000 + "/"
                + pauseToInsert[PROBE_ITERATIONS / 2] / 1000 + "/"
                + pauseToInsert[PROBE_ITERATIONS * 99 / 100] / 1000);
    }

`;
t = t.replace(anchor, probe + anchor);
fs.writeFileSync(tf, t);
console.log('p2 applied');
