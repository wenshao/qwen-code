// A Monitor's life, one revision at a time, plus the shortcuts the contract forbids.
import * as fs from 'node:fs';
const fx = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ref = (resourceId, kind) => ({ resourceId, kind, schemaVersion: 1, byteLength: 64, digest: 'c'.repeat(64) });
const run = (state, execution, runtime, reason = null) => ({ state, reason, definition: null, executionCallId: 'call-1', effectId: null, dispatchId: null, deliveryId: null, execution, runtime, delivery: null });
const b1 = { runtimeBindingId: 'binding-1', generation: '1' };
const b2 = { runtimeBindingId: 'binding-2', generation: '2' };
const mon = (r, o = {}) => ({ monitorId: 'monitor-1', ownerScopeId: 'scope-main', commandRef: fx.monitorRun.commandRef, maxEvents: 3, idleTimeoutMs: 30000, debounceMs: 500, startReceiptRef: null, observationSequence: 0, lastObservationRef: null, notifiedThrough: 0, stopReason: null, outputRef: null, run: r, ...o });
const recA = ref('receipt-gen1', 'managed-monitor-receipt'), recB = ref('receipt-gen2', 'managed-monitor-receipt');
const obs = (n) => ref(`obs-${n}`, 'managed-monitor-observation');
const S = [
  ['admitted, nothing dispatched', mon(run('admitted', null, null))],
  ['start call recorded (intent)', mon(run('admitted', 'intent', null))],
  ['dispatched with binding gen 1', mon(run('running', 'dispatch_started', b1))],
  ['watch attached, receipt gen 1', mon(run('running', 'running_attached', b1), { startReceiptRef: recA })],
  ['observation 1 accepted', mon(run('running', 'running_attached', b1), { startReceiptRef: recA, observationSequence: 1, lastObservationRef: obs(1) })],
  ['notified through 1', mon(run('running', 'running_attached', b1), { startReceiptRef: recA, observationSequence: 1, lastObservationRef: obs(1), notifiedThrough: 1 })],
  ['Runtime lost -> recovery_blocked', mon(run('recovery_blocked', 'outcome_unknown', b1, 'runtime_lost'), { startReceiptRef: recA, observationSequence: 1, lastObservationRef: obs(1), notifiedThrough: 1 })],
  ['rebuilt under gen 2, new receipt', mon(run('running', 'running_attached', b2, 'runtime_lost'), { startReceiptRef: recB, observationSequence: 1, lastObservationRef: obs(1), notifiedThrough: 1 })],
  ['observation 2', mon(run('running', 'running_attached', b2, 'runtime_lost'), { startReceiptRef: recB, observationSequence: 2, lastObservationRef: obs(2), notifiedThrough: 1 })],
  ['observation 3 = maxEvents', mon(run('running', 'running_attached', b2, 'runtime_lost'), { startReceiptRef: recB, observationSequence: 3, lastObservationRef: obs(3), notifiedThrough: 1 })],
  ['settled: max_events', mon(run('settled', 'settled', b2), { startReceiptRef: recB, observationSequence: 3, lastObservationRef: obs(3), notifiedThrough: 1, stopReason: 'max_events' })],
  ['after end: notified through 3', mon(run('settled', 'settled', b2), { startReceiptRef: recB, observationSequence: 3, lastObservationRef: obs(3), notifiedThrough: 3, stopReason: 'max_events' })],
];
const lines = [];
const add = (label, expect, a, b) => lines.push(JSON.stringify({ k: 'monitorSucc', label, expect, a, b }));
for (let i = 1; i < S.length; i++) add(`${S[i - 1][0]}  ->  ${S[i][0]}`, 1, S[i - 1][1], S[i][1]);
const with_ = (m, o) => ({ ...structuredClone(m), ...o });
add('skip dispatch: intent -> running_attached', 0, S[1][1], S[3][1]);
add('dispatch first, binding recorded later', 0, mon(run('running', 'dispatch_started', null)), S[2][1]);
add('observe while the watch is lost', 0, S[6][1], with_(S[6][1], { observationSequence: 2, lastObservationRef: obs(2) }));
add('rebuild keeps the gen 1 receipt', 0, S[6][1], with_(S[7][1], { startReceiptRef: recA }));
add('rebuild under the same generation', 0, S[6][1], with_(S[7][1], { run: run('running', 'running_attached', { runtimeBindingId: 'binding-2', generation: '1' }, 'runtime_lost') }));
add('lost watch "settles" under a new binding', 0, S[6][1], with_(S[6][1], { run: run('failed', 'settled', b2), stopReason: 'watch_failed' }));
add('notification watermark goes back', 0, S[5][1], with_(S[5][1], { notifiedThrough: 0 }));
add('ended monitor changes its stop reason', 0, S[10][1], with_(S[10][1], { stopReason: 'exited' }));
add('settle before maxEvents with max_events', 0, S[8][1], with_(S[10][1], { observationSequence: 2, lastObservationRef: obs(2) }));
process.stdout.write(lines.join('\n') + '\n');
