// S6 (round 3): the PR's HostedChildRunSession (packages/cli dist) driving
// child_run records through the real HTTP store into Spring + MariaDB, with
// child_run enabled in this process only. After every call: the authority's
// view, the Java row and the public task.
import {
  BINDING_1, ENABLED, WT, api, createPublicSession, javaRows, journalCounts, openLog,
  openSession, publish, say, tsView,
} from './lib.mjs';

if (!ENABLED) throw new Error('S6 needs ENABLE_CHILD_RUN=1');
openLog(process.env.LOGNAME_S6 ?? 's6-hosted-child-runs');
const { HostedChildRunSession } = await import(`${WT}/packages/cli/dist/src/serve/hosted-child-run-session.js`);
const pub = await createPublicSession();
const sessionId = pub.id;
const { session, sessionKey } = await openSession({ sessionId, writerId: 'writer-h', create: true });
const runs = new HostedChildRunSession({ authority: session.authority, resources: session.resources }, sessionKey);
const out = { mismatches: 0, sequences: {} };
const m1 = await publish(session, 'managed-tool-result-manifest', { revision: 1, pages: 1 });
const m2 = await publish(session, 'managed-tool-result-manifest', { revision: 2, pages: 2 });

async function step(id, label, fn) {
  const before = journalCounts(sessionId);
  let outcome;
  try {
    await fn();
    outcome = 'ok';
  } catch (e) {
    outcome = `REFUSED ${e.name}: ${e.message.slice(0, 120)}`;
  }
  const ts = tsView(session, id);
  const java = javaRows(sessionId).find((r) => r[0] === id);
  const same = !ts || (java && Number(java[2]) === ts.revision && java[4] === ts.state && java[5] === String(ts.runtimeState ?? 'null'));
  if (!same) out.mismatches++;
  const after = journalCounts(sessionId);
  (out.sequences[id] ??= []).push(`${label}:${outcome === 'ok' ? `${ts?.state}/${ts?.runtimeState ?? '-'}` : 'REFUSED'}`);
  say('step', { id, label, outcome, ts: ts && `rev${ts.revision} ${ts.state}/${ts.runtimeState}`, java: java ? `rev${java[2]} ${java[4]}/${java[5]}` : 'NO ROW', same, txDelta: after.tx - before.tx });
  return outcome;
}

// a. life with three output advances (the last one back to an older manifest), then exit
await step('h-1', 'admit', () => runs.admit({ shellId: 'h-1', ownerScopeId: 'scope', executionCallId: 'call-h1', args: { command: 'npm run dev', is_background: true } }));
await step('h-1', 'dispatchStarted', () => runs.dispatchStarted('h-1', BINDING_1));
await step('h-1', 'attach', () => runs.attach('h-1', BINDING_1, { unit: 'qwen-bg-call-h1', pid: 4242 }));
await step('h-1', 'advanceOutput(m1)', () => runs.advanceOutput('h-1', m1));
await step('h-1', 'advanceOutput(m2)', () => runs.advanceOutput('h-1', m2));
await step('h-1', 'advanceOutput(m1 again)', () => runs.advanceOutput('h-1', m1));
await step('h-1', 'settleExited(0)', () => runs.settleExited('h-1', { exitCode: 0, exitSignal: null }));
await step('h-1', 'settleExited(0) again', () => runs.settleExited('h-1', { exitCode: 0, exitSignal: null }));

// b. stop while running
await step('h-2', 'admit', () => runs.admit({ shellId: 'h-2', ownerScopeId: 'scope', executionCallId: 'call-h2', args: { command: 'tail -f x' } }));
await step('h-2', 'dispatchStarted', () => runs.dispatchStarted('h-2', BINDING_1));
await step('h-2', 'attach', () => runs.attach('h-2', BINDING_1, { unit: 'qwen-bg-call-h2' }));
await step('h-2', 'requestStop', () => runs.requestStop('h-2'));
await step('h-2', 'settleStopRequested', () => runs.settleStopRequested('h-2'));

// c. stop requested before the process started
await step('h-3', 'admit', () => runs.admit({ shellId: 'h-3', ownerScopeId: 'scope', executionCallId: 'call-h3', args: { command: 'sleep 999' } }));
await step('h-3', 'dispatchStarted', () => runs.dispatchStarted('h-3', BINDING_1));
await step('h-3', 'requestStop', () => runs.requestStop('h-3'));
out.preStartStopHonored = await step('h-3', 'settleStopRequested', () => runs.settleStopRequested('h-3'));
out.preStartAsStartFailed = await step('h-3', 'settleFailed(start_failed)', () => runs.settleFailed('h-3', { stopReason: 'start_failed', started: false }));

// d. attach called twice with the same receipt content
await step('h-4', 'admit', () => runs.admit({ shellId: 'h-4', ownerScopeId: 'scope', executionCallId: 'call-h4', args: { command: 'make watch' } }));
await step('h-4', 'dispatchStarted', () => runs.dispatchStarted('h-4', BINDING_1));
await step('h-4', 'attach', () => runs.attach('h-4', BINDING_1, { unit: 'qwen-bg-call-h4', pid: 7 }));
out.attachRetry = await step('h-4', 'attach (same receipt content)', () => runs.attach('h-4', BINDING_1, { unit: 'qwen-bg-call-h4', pid: 7 }));
const r1 = await publish(session, 'managed-runtime-receipt', { same: 'bytes' });
const r2 = await publish(session, 'managed-runtime-receipt', { same: 'bytes' });
out.publishSameBytesSameRef = r1.resourceId === r2.resourceId;
say('publish twice, same bytes', { first: r1.resourceId, second: r2.resourceId, digestEqual: r1.digest === r2.digest });

// e. 30 concurrent output advances, then exit
await step('h-5', 'admit', () => runs.admit({ shellId: 'h-5', ownerScopeId: 'scope', executionCallId: 'call-h5', args: { command: 'yes' } }));
await step('h-5', 'dispatchStarted', () => runs.dispatchStarted('h-5', BINDING_1));
await step('h-5', 'attach', () => runs.attach('h-5', BINDING_1, { unit: 'qwen-bg-call-h5' }));
const manifests = [];
for (let i = 0; i < 30; i++) manifests.push(await publish(session, 'managed-tool-result-manifest', { revision: i + 1, page: i }));
const t0 = journalCounts(sessionId).tx;
const settled = await Promise.allSettled(manifests.map((m) => runs.advanceOutput('h-5', m)));
out.concurrent = { fulfilled: settled.filter((s) => s.status === 'fulfilled').length, rejected: settled.filter((s) => s.status === 'rejected').length, txAdded: journalCounts(sessionId).tx - t0, finalRevision: tsView(session, 'h-5').revision };
say('30 concurrent advanceOutput', out.concurrent);
await step('h-5', 'settleExited(signal)', () => runs.settleExited('h-5', { exitCode: null, exitSignal: 'TERM' }));

const list = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice' });
say('public tasks', (list.json.data ?? []).map((t) => `${t.kind} ${t.state}/${t.runtime_state ?? '-'}`));
const ev = await api('GET', `/v1/agents/sessions/${sessionId}/events?limit=100`, { actor: 'alice' });
const tu = (ev.json.data ?? []).filter((e) => e.type === 'task.updated').map((e) => e.data.state);
say('task.updated states (first 100 events)', tu);
await session.close();
const b = await openSession({ sessionId, writerId: 'writer-h2' });
out.coldReopenStates = b.session.authority.taskViews().map((v) => `${v.state}/${v.runtimeState}`);
await b.session.close();
out.sessionId = sessionId;
say('RESULT', out);
