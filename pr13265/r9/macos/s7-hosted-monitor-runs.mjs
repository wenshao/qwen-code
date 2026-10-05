// S7 (round 5): the PR's HostedMonitorSession (packages/cli dist) driving
// monitor_run records through the real HTTP store into Spring + MySQL, with
// monitor_run enabled in this process only (the product keeps it disabled).
// After every call: the authority's view and the Java row. Then the v2 gate:
// a v1-header Session refused by TS, and what the server does when the TS
// gate is bypassed.
import { createHash } from 'node:crypto';
import {
  BINDING_1, WT, api, createPublicSession, javaRows, journalCounts, openLog,
  openSession, publish, records, say, sql, DB, TENANT,
} from './lib.mjs';

if (!records.MANAGED_SESSION_ENABLED_DOMAINS.includes('monitor_run')) {
  records.MANAGED_SESSION_ENABLED_DOMAINS.push('monitor_run');
}
openLog(process.env.LOGNAME_S7 ?? 's7-hosted-monitor-runs');
const { HostedMonitorSession } = await import(`${WT}/packages/cli/dist/src/serve/hosted-monitor-session.js`);
const pub = await createPublicSession();
const sessionId = pub.id;
const { session, sessionKey } = await openSession({ sessionId, writerId: 'writer-m', create: true });
const runs = new HostedMonitorSession({ authority: session.authority, resources: session.resources }, sessionKey);
const out = { mismatches: 0, sequences: {} };
const m1 = await publish(session, 'managed-tool-result-manifest', { revision: 1, pages: 1 });
const m2 = await publish(session, 'managed-tool-result-manifest', { revision: 2, pages: 2 });

function tsView(id) {
  const r = session.authority.extensionRecord('monitor_run', id);
  if (!r) return null;
  const body = records.parseMonitorRun ? records.parseMonitorRun(r.record) : r.record;
  return { revision: r.revision, state: r.task.state, runtimeState: r.task.runtimeState, seq: body.observationSequence, notified: body.notifiedThrough };
}
async function notification(id, n) {
  return {
    input: {
      inputId: `${id}:notify:${n}`,
      turnId: `${id}:notify:${n}`,
      source: 'monitor',
      contentRef: await session.resources.publish('managed-input', Buffer.from(JSON.stringify({ text: `line ${n}` }), 'utf8')),
      deadline: null,
      admissionRef: await session.resources.publish('managed-admission', Buffer.from('{}', 'utf8')),
      wakeReason: 'input',
    },
  };
}
async function step(id, label, fn) {
  const before = journalCounts(sessionId);
  let outcome;
  try {
    await fn();
    outcome = 'ok';
  } catch (e) {
    outcome = `REFUSED ${e.name}: ${e.message.slice(0, 110)}`;
  }
  const ts = tsView(id);
  const java = javaRows(sessionId).find((r) => r[0] === id);
  const same = !ts || (java && Number(java[2]) === ts.revision && java[4] === ts.state && java[5] === String(ts.runtimeState ?? 'null'));
  if (!same) out.mismatches++;
  const after = journalCounts(sessionId);
  (out.sequences[id] ??= []).push(`${label}:${outcome === 'ok' ? `${ts?.state}/${ts?.runtimeState ?? '-'}` : 'REFUSED'}`);
  say('step', { id, label, outcome, ts: ts && `rev${ts.revision} ${ts.state}/${ts.runtimeState} seq${ts.seq} notified${ts.notified}`, java: java ? `rev${java[2]} ${java[3]} ${java[4]}/${java[5]}` : 'NO ROW', same, txDelta: after.tx - before.tx });
  return outcome;
}
const admit = (id, maxEvents = 3) => runs.admit({ monitorId: id, ownerScopeId: 'scope', executionCallId: `call-${id}`, args: { command: 'tail -f build.log' }, maxEvents, idleTimeoutMs: 60_000, debounceMs: 1000 });

// a. life: three observations (two with a notification), output, quota settle
await step('m-1', 'admit(maxEvents 3)', () => admit('m-1'));
await step('m-1', 'dispatchStarted', () => runs.dispatchStarted('m-1', BINDING_1));
await step('m-1', 'attach', () => runs.attach('m-1', BINDING_1, { watch: 'started' }));
await step('m-1', 'observe(1)+notify', async () => runs.observe('m-1', { lines: 1 }, await notification('m-1', 1)));
await step('m-1', 'observe(2)', () => runs.observe('m-1', { lines: 2 }));
await step('m-1', 'settleQuiet(max_events) early', () => runs.settleQuiet('m-1', 'max_events'));
await step('m-1', 'observe(3)+notify', async () => runs.observe('m-1', { lines: 3 }, await notification('m-1', 3)));
await step('m-1', 'advanceOutput(m2)', () => runs.advanceOutput('m-1', m2));
await step('m-1', 'advanceOutput(m1) back', () => runs.advanceOutput('m-1', m1));
await step('m-1', 'observe(4) past quota', () => runs.observe('m-1', { lines: 4 }));
await step('m-1', 'settleQuiet(max_events)', () => runs.settleQuiet('m-1', 'max_events'));
await step('m-1', 'settleQuiet again', () => runs.settleQuiet('m-1', 'max_events'));

// b. observation before attach; second attach
await step('m-2', 'admit', () => admit('m-2'));
await step('m-2', 'dispatchStarted', () => runs.dispatchStarted('m-2', BINDING_1));
await step('m-2', 'observe before attach', () => runs.observe('m-2', { lines: 1 }));
await step('m-2', 'attach', () => runs.attach('m-2', BINDING_1, { watch: 'started' }));
out.secondAttach = await step('m-2', 'attach again (same content)', () => runs.attach('m-2', BINDING_1, { watch: 'started' }));
await step('m-2', 'settleQuiet(idle_timeout)', () => runs.settleQuiet('m-2', 'idle_timeout'));

// c. stop, then a late notification
await step('m-3', 'admit', () => admit('m-3'));
await step('m-3', 'dispatchStarted', () => runs.dispatchStarted('m-3', BINDING_1));
await step('m-3', 'attach', () => runs.attach('m-3', BINDING_1, { watch: 'started' }));
await step('m-3', 'settleStopRequested', () => runs.settleStopRequested('m-3'));
await step('m-3', 'observe after cancel +notify', async () => runs.observe('m-3', { lines: 1 }, await notification('m-3', 1)));

// d. start failures
await step('m-4', 'admit', () => admit('m-4'));
await step('m-4', 'dispatchStarted', () => runs.dispatchStarted('m-4', BINDING_1));
await step('m-4', 'settleFailed(start_failed)', () => runs.settleFailed('m-4', { stopReason: 'start_failed', started: false }));

const kinds = sql(`SELECT CAST(record_bytes AS CHAR) FROM qwen_managed_session_journal_tx WHERE tenant_id='${TENANT}' AND session_id='${sessionId}' ORDER BY journal_revision`, DB)
  .map((r) => [...r[0].matchAll(/"kind":"([a-z._]+)"/g)].map((m) => m[1]).filter((k) => /input\.accepted|wake\.requested|domain\.committed/.test(k)).join('+'))
  .filter(Boolean);
out.notifyTx = kinds.filter((k) => k.includes('input.accepted')).length;
say('journal tx with notification events', kinds.filter((k) => k.includes('input.accepted')));
const list = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice' });
out.publicTasks = (list.json.data ?? []).map((t) => `${t.kind} ${t.state}/${t.runtime_state ?? '-'}`);
say('public tasks', out.publicTasks);
await session.close();
const b = await openSession({ sessionId, writerId: 'writer-m2' });
out.coldReopenStates = b.session.authority.taskViews().map((v) => `${v.kind ?? ''} ${v.state}/${v.runtimeState}`);
await b.session.close();

// e. the v2 gate on a v1-header Session (created by the previous head)
const v1 = process.env.V1_SESSION;
if (v1) {
  const { session: s1, sessionKey: k1 } = await openSession({ sessionId: v1, writerId: `writer-v1-${Date.now()}` });
  const gated = new HostedMonitorSession({ authority: s1.authority, resources: s1.resources }, k1);
  const tsGate = await gated.admit({ monitorId: 'm-v1', ownerScopeId: 'scope', executionCallId: 'call-m-v1', args: { command: 'x' }, maxEvents: 3, idleTimeoutMs: 60_000, debounceMs: 1000 }).then(() => 'accepted', (e) => `${e.name}: ${e.message}`);
  // Bypass only the TS header gate on this instance: what does the server do?
  s1.authority.assertDomainAdmittable = () => {};
  const serverGate = await gated.admit({ monitorId: 'm-v1b', ownerScopeId: 'scope', executionCallId: 'call-m-v1b', args: { command: 'x' }, maxEvents: 3, idleTimeoutMs: 60_000, debounceMs: 1000 }).then(() => 'accepted', (e) => `${e.name}: ${e.message}`);
  const row = javaRows(v1).find((r) => r[0] === 'm-v1b');
  out.v1Gate = { tsGate, serverGate, javaRow: row ? `rev${row[2]} ${row[1]} ${row[4]}` : 'NO ROW' };
  await s1.close();
  say('v1-header Session', out.v1Gate);
}
out.sessionId = sessionId;
say('RESULT', out);
process.exit(0);
