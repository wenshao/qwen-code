// Targeted inputs for survivors the random walk did not reach.
import fs from 'node:fs';
const F = JSON.parse(fs.readFileSync(`${process.env.WT}/packages/core/src/managed-runtime/contracts/managed-child-run-record-v1.fixtures.json`, 'utf8'));
const T = F.templates.child_run;
const body = (patch) => ({ ...T, ...patch, run: { ...T.run, ...(patch.run ?? {}) } });
const B1 = { runtimeBindingId: 'binding-1', generation: '1' };
const cases = {
  'T62 pre-start stop: cancelled + not_started_proven + stop_requested': body({ stopRequested: true, stopReason: 'stop_requested', run: { state: 'cancelled', execution: 'not_started_proven', runtime: B1 } }),
  'T63 failed + dispatch_started + start_failed': body({ stopReason: 'start_failed', run: { state: 'failed', execution: 'dispatch_started', runtime: B1 } }),
  'T64 start_failed + execution intent': body({ stopReason: 'start_failed', run: { state: 'failed', execution: 'intent' } }),
  'T65 start_failed + receipt + not_started_proven': body({ stopReason: 'start_failed', startReceiptRef: { resourceId: 'r', kind: 'managed-runtime-receipt', schemaVersion: 1, byteLength: 2, digest: 'b'.repeat(64) }, run: { state: 'failed', execution: 'not_started_proven', runtime: B1 } }),
};
const lines = Object.entries(cases).map(([label, b], i) => JSON.stringify({ id: i, type: 'record', body: b, label }));
fs.writeFileSync(process.env.OUT, lines.join('\n') + '\n');
console.log(Object.keys(cases).map((l, i) => `${i}: ${l}`).join('\n'));
