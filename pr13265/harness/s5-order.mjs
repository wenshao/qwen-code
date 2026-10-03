// S5: deployment order (design: Reader gating; H0c open question 7).
// PHASE=old  — an H3-capable writer (child_run enabled) against the server
//              jar from before this PR: what does the old store do with it?
// PHASE=new  — the same database, now served by this PR's jar: a second
//              writer reopens the Session and commits the next revision.
import fs from 'node:fs';
import {
  BINDING_1, ENABLED, RIG, api, child, commitChild, createPublicSession, javaRows, journalCounts,
  openLog, openSession, publish, say, sql, tsView,
} from './lib.mjs';

if (!ENABLED) throw new Error('S5 needs ENABLE_CHILD_RUN=1');
const PHASE = process.env.PHASE;
openLog(`s5-order-${PHASE}`);
const state = `${RIG}/out/s5-state.json`;

if (PHASE === 'old') {
  const pub = await createPublicSession();
  const sessionId = pub.id;
  const { session, sessionKey } = await openSession({ sessionId, writerId: 'writer-old', create: true });
  const cmd = await publish(session, 'managed-tool-args', { command: 'npm run dev', cwd: '/workspace' });
  const receipt = await publish(session, 'managed-runtime-receipt', { unit: 'qwen-shell-1.scope' });
  const S = (run, extra = {}) => child({ commandRef: cmd, ...extra, run: { executionCallId: 'call-1', ...run } });
  const steps = [
    ['admit', S({})],
    ['dispatch', S({ state: 'running', execution: 'dispatch_started', runtime: BINDING_1 })],
    ['attach', S({ state: 'running', execution: 'running_attached', runtime: BINDING_1 }, { startReceiptRef: receipt })],
  ];
  for (const [label, body] of steps) {
    const r = await commitChild(session, sessionKey, `shell-1:${label}`, body);
    say('commit on old server', { label, rev: r.revision, ts: tsView(session, 'shell-1') });
  }
  // A first revision that is not a start: the old server has no rule to refuse it.
  let skip = 'not attempted';
  if (process.env.SKIP_BAD !== '1') try {
    session.authority.assertExtensionRevision = () => {};
    const r = await commitChild(session, sessionKey, 'shell-2:attach-first', child({ shellId: 'shell-2', commandRef: cmd, startReceiptRef: receipt, run: { executionCallId: 'call-2', state: 'running', execution: 'running_attached', runtime: BINDING_1 } }));
    skip = `accepted rev${r.revision}`;
  } catch (e) {
    skip = `${e.name}: ${e.message.slice(0, 160)}`;
  }
  say('non-start first revision on old server (bypass writer)', skip);
  const list = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice' });
  const rows = javaRows(sessionId);
  const events = sql(`SELECT COUNT(*) FROM qwen_managed_session_journal_tx WHERE session_id='${sessionId}' AND operation='commitChildRun'`)[0][0];
  say('old server state', { authorityTasks: session.authority.taskViews().map((v) => `${v.kind} ${v.state}`), publicTasks: (list.json.data ?? []).map((t) => `${t.kind} ${t.state}`), javaRows: rows.length, childRunTransactions: Number(events), journal: journalCounts(sessionId) });
  await session.close();
  fs.writeFileSync(state, JSON.stringify({ sessionId, cmd, receipt }));
  say('RESULT', { phase: 'old', sessionId, skip, publicTasks: (list.json.data ?? []).length, javaRows: rows.length, authorityTasks: session.authority.taskViews().length });
} else {
  const { sessionId, cmd, receipt } = JSON.parse(fs.readFileSync(state, 'utf8'));
  let opened;
  try {
    opened = await openSession({ sessionId, writerId: 'writer-new' });
  } catch (e) {
    say('reopen on new server', `${e.name}: ${e.message.slice(0, 200)}`);
    say('RESULT', { phase: 'new', reopen: 'failed' });
    process.exit(0);
  }
  const { session, sessionKey } = opened;
  say('reopen on new server', { authorityTasks: session.authority.taskViews().map((v) => `${v.kind} ${v.state} rev${session.authority.extensionRecord('child_run', v.taskId) ? '' : ''}`), javaRows: javaRows(sessionId).length });
  const output = await publish(session, 'managed-tool-result-manifest', { pages: 1 });
  const before = journalCounts(sessionId);
  let next;
  try {
    const r = await commitChild(session, sessionKey, 'shell-1:output', child({ commandRef: cmd, startReceiptRef: receipt, outputRef: output, run: { executionCallId: 'call-1', state: 'running', execution: 'running_attached', runtime: BINDING_1 } }));
    next = `accepted rev${r.revision}`;
  } catch (e) {
    next = `${e.name}: ${e.message.slice(0, 220)}`;
  }
  say('next revision on new server', { next, before, after: journalCounts(sessionId) });
  let after;
  try {
    const r = await commitChild(session, sessionKey, 'shell-9:admit', child({ shellId: 'shell-9', commandRef: cmd, run: { executionCallId: 'call-9' } }));
    after = `accepted rev${r.revision}`;
  } catch (e) {
    after = `${e.name}: ${e.message.slice(0, 160)}`;
  }
  say('an unrelated new Shell afterwards', after);
  const list = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice' });
  say('public tasks on new server', (list.json.data ?? []).map((t) => `${t.kind} ${t.state}`));
  await session.close().catch((e) => say('close', `${e.name}: ${e.message.slice(0, 120)}`));
  say('RESULT', { phase: 'new', next, after, publicTasks: (list.json.data ?? []).length });
}
