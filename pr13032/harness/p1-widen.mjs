// P1 (rig-only): after each insert->claim gap in the six tests, give the
// recovery scanner up to 500 ms to claim the Turn before the test claims it.
// Same edit on both arms; the only difference between arms is the PR's pause.
import fs from 'node:fs';
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
const anchor = '    private PlatformTransactionManager transactionManager;\n';
if (!src.includes(anchor)) throw new Error('field anchor missing');
const helper = `
    // PROBE (rig-only): widen the insert->claim gap to 500 ms and report
    // whether the recovery scanner claimed the Turn inside it.
    private void awaitScannerChance(String tenant, String sessionId,
            String turnId) {
        String test = StackWalker.getInstance().walk(frames -> frames
                .skip(1).findFirst()).get().getMethodName();
        long start = System.nanoTime();
        long deadline = start + TimeUnit.MILLISECONDS.toNanos(500);
        while (System.nanoTime() < deadline) {
            TurnRecord record = store.findTurn(tenant, sessionId, turnId)
                    .orElseThrow();
            if (record.dispatchOwner() != null
                    || !"ACCEPTED".equals(record.status())) {
                System.out.println("PROBE-P1 " + test + " scanner-claimed after "
                        + TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
                        + "ms owner=" + record.dispatchOwner() + " status="
                        + record.status());
                return;
            }
            try {
                Thread.sleep(5);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        System.out.println("PROBE-P1 " + test + " no-scanner-claim-in-500ms");
    }
`;
src = src.replace(anchor, anchor + helper);
if (!/import com\.alibaba\.qwen\.code\.managedagent\.store\.StoreModels\.TurnRecord;/.test(src)) {
  src = src.replace(/(import com\.alibaba\.qwen\.code\.managedagent\.store\.StoreModels\.[A-Za-z]+;\n)/, '$1import com.alibaba.qwen.code.managedagent.store.StoreModels.TurnRecord;\n');
}
const methods = [
  'retractionRenamesTheDeltaThatContinuedTheRetractedOne',
  'ignoresLateEnvironmentResultFromAnOlderTurn',
  'persistsRetryBackoffAcrossClaims',
  'transfersHarnessGenerationOnlyBeforeAdmissionUnderDispatchLease',
  'recoversAdmittedHarnessGenerationAndEventEpochUnderDispatchLease',
  'retractsOnlyTheIncompleteContinuationEpoch',
];
let inserted = 0;
for (const m of methods) {
  const start = src.indexOf(`    void ${m}() {`);
  if (start < 0) throw new Error('method missing ' + m);
  const claimIdx = src.indexOf('assertThat(store.claimTurn(', start);
  const lineStart = src.lastIndexOf('\n', claimIdx) + 1;
  const call = src.slice(claimIdx, src.indexOf('Duration', claimIdx));
  const mm = /store\.claimTurn\(\s*tenant,\s*([^,]+?),\s*([a-z]+)\.turnId\(\)/.exec(call);
  if (!mm) throw new Error('cannot parse claim in ' + m + ': ' + call);
  const line = `        awaitScannerChance(tenant, ${mm[1]}, ${mm[2]}.turnId());\n`;
  src = src.slice(0, lineStart) + line + src.slice(lineStart);
  inserted++;
  if (m === 'transfersHarnessGenerationOnlyBeforeAdmissionUnderDispatchLease') {
    const rel = src.indexOf('store.releaseTurnLease(', src.indexOf(`    void ${m}() {`));
    const end = src.indexOf(';\n', rel) + 2;
    src = src.slice(0, end) + `        awaitScannerChance(tenant, session.sessionId(), turn.turnId());\n` + src.slice(end);
    inserted++;
  }
}
fs.writeFileSync(file, src);
console.log('inserted', inserted, 'probe calls');
