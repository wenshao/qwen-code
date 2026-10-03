// S2: with child_run enabled in this process only, the built authority
// commits background Shell chains over HTTP into the real Java store. After
// every revision the authority's task view, the Java row and the public task
// API must agree; a cold reopen by a second writer must rebuild the same views.
import {
  BINDING_1, BINDING_2, ENABLED, api, child, commitChild, createPublicSession, javaRows,
  journalCounts, openLog, openSession, publish, say, tsView,
} from './lib.mjs';

if (!ENABLED) throw new Error('S2 needs ENABLE_CHILD_RUN=1');
openLog(process.env.LOGNAME_S2 ?? 's2-chain');
const out = { mismatches: 0, commits: 0 };
const pub = await createPublicSession();
const sessionId = pub.id;
say('session', { sessionId, capabilities: pub.capabilities });
const { session, sessionKey } = await openSession({ sessionId, writerId: 'writer-a', create: true });

const res = {};
res.cmd1 = await publish(session, 'managed-tool-args', { command: 'npm run dev', cwd: '/workspace' });
res.cmd2 = await publish(session, 'managed-tool-args', { command: 'tail -f log', cwd: '/workspace' });
res.cmd3 = await publish(session, 'managed-tool-args', { command: 'make watch', cwd: '/workspace' });
res.receipt1 = await publish(session, 'managed-runtime-receipt', { unit: 'qwen-shell-1.scope', pid: 4242 });
res.receipt2 = await publish(session, 'managed-runtime-receipt', { unit: 'qwen-shell-2.scope', pid: 4343 });
res.receipt3 = await publish(session, 'managed-runtime-receipt', { unit: 'qwen-shell-3.scope', pid: 4444 });
res.receipt3b = await publish(session, 'managed-runtime-receipt', { unit: 'qwen-shell-3.scope', attachedBy: 'binding-2' });
try {
  res.manifest1 = await publish(session, 'managed-tool-result-manifest', { pages: 1 });
  res.manifest2 = await publish(session, 'managed-tool-result-manifest', { pages: 2 });
} catch (e) {
  say('manifest publish refused', `${e.name}: ${e.message}`);
  throw e;
}
say('resources', Object.fromEntries(Object.entries(res).map(([k, v]) => [k, `${v.kind}/${v.resourceId.slice(0, 12)}`])));

async function step(label, id, body) {
  const before = journalCounts(sessionId);
  try {
    const r = await commitChild(session, sessionKey, `${id}:${label}`, body);
    out.commits++;
    const ts = tsView(session, id);
    const java = javaRows(sessionId).find((row) => row[0] === id);
    const same = java !== undefined && java[1] === 'child_run' && Number(java[2]) === ts.revision && java[3] === ts.kind && java[4] === ts.state && java[5] === String(ts.runtimeState ?? 'null');
    if (!same) out.mismatches++;
    say('commit', { id, label, rev: r.revision, ts: `${ts.kind} ${ts.state}/${ts.runtimeState}`, java: java ? `${java[3]} ${java[4]}/${java[5]} rev${java[2]}` : 'NO ROW', same });
    return true;
  } catch (e) {
    const after = journalCounts(sessionId);
    say('refused', { id, label, error: `${e.name}: ${e.message}`, unchanged: JSON.stringify(before) === JSON.stringify(after) });
    return false;
  }
}

// A: the six-revision life from the PR's authority test, with real resources.
const A = (run, extra = {}) => child({ shellId: 'shell-1', commandRef: res.cmd1, ...extra, run: { executionCallId: 'call-shell-1', ...run } });
await step('admit', 'shell-1', A({}));
await step('dispatch', 'shell-1', A({ state: 'running', execution: 'dispatch_started', runtime: BINDING_1 }));
await step('attach', 'shell-1', A({ state: 'waiting', execution: 'running_attached', runtime: BINDING_1 }, { startReceiptRef: res.receipt1 }));
await step('output', 'shell-1', A({ state: 'running', execution: 'running_attached', runtime: BINDING_1 }, { startReceiptRef: res.receipt1, outputRef: res.manifest1 }));
await step('output2', 'shell-1', A({ state: 'waiting', execution: 'running_attached', runtime: BINDING_1 }, { startReceiptRef: res.receipt1, outputRef: res.manifest2 }));
await step('exit', 'shell-1', A({ state: 'settled', execution: 'settled', runtime: BINDING_1 }, { startReceiptRef: res.receipt1, outputRef: res.manifest2, stopReason: 'exited', exitCode: 0 }));
// Refusals that must leave the journal untouched.
await step('reopen-settled', 'shell-1', A({ state: 'running', execution: 'running_attached', runtime: BINDING_1 }, { startReceiptRef: res.receipt1, outputRef: res.manifest2 }));

// B: stopped by request.
const B = (run, extra = {}) => child({ shellId: 'shell-2', commandRef: res.cmd2, ...extra, run: { executionCallId: 'call-shell-2', ...run } });
await step('admit', 'shell-2', B({}));
await step('skip-dispatch', 'shell-2', B({ state: 'waiting', execution: 'running_attached', runtime: BINDING_1 }, { startReceiptRef: res.receipt2 }));
await step('dispatch', 'shell-2', B({ state: 'running', execution: 'dispatch_started', runtime: BINDING_1 }));
await step('attach', 'shell-2', B({ state: 'running', execution: 'running_attached', runtime: BINDING_1 }, { startReceiptRef: res.receipt2 }));
await step('stop', 'shell-2', B({ state: 'cancelled', execution: 'settled', runtime: BINDING_1 }, { startReceiptRef: res.receipt2, stopReason: 'stop_requested' }));

// C: Runtime lost, then the replacement worker re-attaches the same process.
const C = (run, extra = {}) => child({ shellId: 'shell-3', commandRef: res.cmd3, ...extra, run: { executionCallId: 'call-shell-3', ...run } });
await step('admit', 'shell-3', C({}));
await step('dispatch', 'shell-3', C({ state: 'running', execution: 'dispatch_started', runtime: BINDING_1 }));
await step('attach', 'shell-3', C({ state: 'running', execution: 'running_attached', runtime: BINDING_1 }, { startReceiptRef: res.receipt3 }));
await step('runtime-lost', 'shell-3', C({ state: 'recovery_blocked', reason: 'runtime_lost', execution: 'outcome_unknown', runtime: BINDING_1 }, { startReceiptRef: res.receipt3 }));
out.reattachSameReceipt = await step('reattach-same-receipt', 'shell-3', C({ state: 'running', reason: 'runtime_lost', execution: 'running_attached', runtime: BINDING_2 }, { startReceiptRef: res.receipt3 }));
out.reattachNewReceipt = await step('reattach-new-receipt', 'shell-3', C({ state: 'running', reason: 'runtime_lost', execution: 'running_attached', runtime: BINDING_2 }, { startReceiptRef: res.receipt3b }));

const tsViews = session.authority.taskViews();
const list = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice' });
say('public tasks', { status: list.status, tasks: (list.json.data ?? []).map((t) => `${t.kind} ${t.state}/${t.runtime_state ?? '-'} ${t.id.slice(0, 13)}`) });
const pick = (t) => [t.id, t.kind, t.state, t.runtime_state ?? null, t.created_at, t.started_at ?? null, t.settled_at ?? null];
const fromTs = (v) => [v.taskId, v.kind, v.state, v.runtimeState, v.createdAt, v.startedAt, v.settledAt];
out.publicEqualsTs = JSON.stringify((list.json.data ?? []).map(pick).sort()) === JSON.stringify(tsViews.map(fromTs).sort());
say('public == authority', out.publicEqualsTs);
for (const v of tsViews) {
  const d = await api('GET', `/v1/agents/sessions/${sessionId}/tasks/${v.taskId}`, { actor: 'alice' });
  say('task detail', { status: d.status, body: d.json });
}
const ev = await api('GET', `/v1/agents/sessions/${sessionId}/events?limit=100`, { actor: 'alice' });
const tu = (ev.json.data ?? []).filter((e) => e.type === 'task.updated');
say('task.updated events', tu.map((e) => `${e.sequence}:${e.data.kind ?? ''}:${e.data.state}`));
out.taskUpdated = tu.length;
await session.close();

const b = await openSession({ sessionId, writerId: 'writer-b' });
const viewsB = b.session.authority.taskViews();
out.coldReopenEqual = JSON.stringify(viewsB) === JSON.stringify(tsViews);
say('cold reopen by writer-b', { equal: out.coldReopenEqual, views: viewsB.map((v) => `${v.kind} ${v.state}/${v.runtimeState}`) });
await b.session.close();
out.sessionId = sessionId;
say('RESULT', out);
