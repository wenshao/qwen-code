// S1: both accepted fixture chains + a notification input, committed by the
// PR's TypeScript authority over HTTP into the real Java store on MariaDB.
// Compares the authority's view with every Java surface after each revision.
import fs from 'node:fs';
import {
  FIXTURES, RefMapper, api, commitMonitor, createPublicSession, javaRows,
  journalCounts, openLog, openSession, say, sql, tsViewAsRow, TENANT,
} from './lib.mjs';

openLog('s1-chains');
const out = {};
const pub = await createPublicSession({ actor: 'alice' });
const sessionId = pub.id;
say('create', { sessionId, capabilities: pub.capabilities });
const empty = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice' });
say('tasks-empty', { status: empty.status, body: empty.json });
const ws0 = await api('POST', '/api/agent/web-shell/v1/sessions/get', { actor: 'alice', body: { sessionId } });
say('webshell-session-capabilities', { status: ws0.status, capabilities: ws0.json.capabilities });

const { session, sessionKey } = await openSession({ sessionId, writerId: 'writer-a', create: true });
const refs = new RefMapper(session.resources);
const [chainA, chainB] = FIXTURES.monitorChainCases;
const bodiesA = await Promise.all(chainA.revisions.map((r) => refs.remap(r.monitorRun)));
const bodiesB = await Promise.all(
  chainB.revisions.map((r) => refs.remap({ ...r.monitorRun, monitorId: 'monitor-2' })),
);
// Interleave the two chains: A1 B1 A2 B2 A3 .. A8
const plan = [];
for (let i = 0; i < bodiesA.length; i++) {
  plan.push(['monitor-1', i, bodiesA[i]]);
  if (i < bodiesB.length) plan.push(['monitor-2', i, bodiesB[i]]);
}
let mismatches = 0;
for (const [id, i, body] of plan) {
  let input;
  if (id === 'monitor-1' && i === bodiesA.length - 1) {
    input = {
      inputId: 'monitor-1:notify:1',
      turnId: 'monitor-1:notify:1',
      source: 'monitor',
      contentRef: await session.resources.publish('managed-input', Buffer.from('{"text":"changed"}')),
      deadline: null,
      admissionRef: await session.resources.publish('managed-admission', Buffer.from('{}')),
      wakeReason: 'input',
    };
  }
  const receipt = await commitMonitor(session, sessionKey, `${id}:${i + 1}`, body, input);
  const ts = session.authority.extensionRecord('monitor_run', id);
  const java = javaRows(sessionId).find((r) => r[0] === id);
  const same = JSON.stringify(tsViewAsRow(ts)) === JSON.stringify(java.slice(0, 10));
  if (!same) mismatches++;
  const expected = (id === 'monitor-1' ? chainA : chainB).revisions[i].view;
  say('commit', {
    id, rev: receipt.revision, seq: `${receipt.receipt.firstSequence}-${receipt.receipt.lastSequence}`,
    ts: `${ts.task.state}/${ts.task.runtimeState}`, java: `${java[2]}/${java[3]}`,
    fixture: `${expected.state}/${expected.runtimeState}`, same,
  });
}
out.mismatches = mismatches;

// A stepped-back revision: the authority must refuse before publishing.
const before = journalCounts(sessionId);
let refused;
try {
  await commitMonitor(session, sessionKey, 'monitor-2:back', bodiesB[0]);
} catch (e) {
  refused = `${e.name}: ${e.message}`;
}
say('stepped-back', { refused, before, after: journalCounts(sessionId) });

// The input and its wake landed in the same transaction as the record.
const lastTx = sql(
  `SELECT first_sequence, last_sequence, event_count, operation, command_id FROM qwen_managed_session_journal_tx WHERE session_id='${sessionId}' AND command_id='monitor-1:8'`,
);
say('input-tx', lastTx);

const tsViews = session.authority.taskViews();
const outbox = session.authority.extensionOutbox();
say('ts-taskViews', tsViews);
say('ts-outbox', outbox.map((r) => r.recordId));

const list = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice' });
say('public-list', { status: list.status, body: list.json });
const toPublic = (v) => ({
  id: v.taskId, object: 'agent.task', session_id: v.sessionId, kind: v.kind, state: v.state,
  ...(v.definitionRevision !== null ? { definition_revision: v.definitionRevision } : {}),
  ...(v.runtimeState !== null ? { runtime_state: v.runtimeState } : {}),
  created_at: v.createdAt,
  ...(v.startedAt !== null ? { started_at: v.startedAt } : {}),
  ...(v.settledAt !== null ? { settled_at: v.settledAt } : {}),
});
const pick = (t) => Object.fromEntries(Object.entries(t).filter(([k]) => ['id','object','session_id','kind','state','definition_revision','runtime_state','created_at','started_at','settled_at'].includes(k) && t[k] !== null));
out.publicEqualsTs = JSON.stringify(list.json.data.map(pick)) === JSON.stringify(tsViews.map(toPublic));
say('public==ts (order+fields)', out.publicEqualsTs);
for (const v of tsViews) {
  const d = await api('GET', `/v1/agents/sessions/${sessionId}/tasks/${v.taskId}`, { actor: 'alice' });
  const w = await api('POST', '/api/agent/web-shell/v1/tasks/get', { actor: 'alice', body: { sessionId, taskId: v.taskId } });
  say('detail', { taskId: v.taskId.slice(0, 16), public: d.status, webshell: w.status, webshellBody: w.json });
}
const wq = await api('POST', '/api/agent/web-shell/v1/tasks/query', { actor: 'alice', body: { sessionId } });
say('webshell-query', { status: wq.status, ids: wq.json.data?.map((t) => t.taskId.slice(0, 16)), nextCursor: wq.json.nextCursor, hasMore: wq.json.hasMore });

// Isolation
const foreign = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { tenant: 't-other', actor: 'alice' });
const foreignDetail = await api('GET', `/v1/agents/sessions/${sessionId}/tasks/${tsViews[0].taskId}`, { tenant: 't-other' });
const bob = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'bob' });
const noActor = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, {});
const unknownTask = await api('GET', `/v1/agents/sessions/${sessionId}/tasks/task_${'0'.repeat(64)}`, { actor: 'alice' });
const badTask = await api('GET', `/v1/agents/sessions/${sessionId}/tasks/not-a-task`, { actor: 'alice' });
const badCursor = await api('GET', `/v1/agents/sessions/${sessionId}/tasks?cursor=zzz`, { actor: 'alice' });
const badLimit0 = await api('GET', `/v1/agents/sessions/${sessionId}/tasks?limit=0`, { actor: 'alice' });
const badLimit101 = await api('GET', `/v1/agents/sessions/${sessionId}/tasks?limit=101`, { actor: 'alice' });
const badLimitAbc = await api('GET', `/v1/agents/sessions/${sessionId}/tasks?limit=abc`, { actor: 'alice' });
say('isolation+errors', {
  foreignTenant: [foreign.status, foreign.json?.error?.code],
  foreignDetail: [foreignDetail.status, foreignDetail.json?.error?.code],
  otherActorSameTenant: [bob.status, bob.json?.error?.code ?? `data=${bob.json?.data?.length}`],
  noActor: [noActor.status, noActor.json?.error?.code ?? `data=${noActor.json?.data?.length}`],
  unknownTask: [unknownTask.status, unknownTask.json?.error?.code],
  malformedTaskId: [badTask.status, badTask.json?.error?.code],
  badCursor: [badCursor.status, badCursor.json?.error?.code],
  limit0: [badLimit0.status, badLimit0.json?.error?.code],
  limit101: [badLimit101.status, badLimit101.json?.error?.code],
  limitAbc: [badLimitAbc.status, badLimitAbc.json?.error?.code],
});

// Session events
const ev = await api('GET', `/v1/agents/sessions/${sessionId}/events?limit=100`, { actor: 'alice' });
const taskEvents = (ev.json.data ?? []).filter((e) => e.type === 'task.updated');
say('events', { status: ev.status, total: ev.json.data?.length, types: (ev.json.data ?? []).map((e) => e.type) });
say('task.updated', taskEvents.map((e) => `${e.sequence}:${e.data.taskId.slice(5, 13)}:${e.data.state}`));
out.taskUpdatedCount = taskEvents.length;

fs.writeFileSync(`${process.env.OUT ?? '/dev/null'}`, JSON.stringify({ sessionId, list: list.text, tsViews }, null, 1));
// close writer A (hand-off), cold reopen as writer B
let grantA;
try {
  grantA = session.authority.issueOperationGrant({
    domain: 'monitor_run', recordId: 'monitor-1', ownerId: 'owner-1', workspaceGeneration: '1', phases: ['observe'], leaseDurationMs: 60000,
  });
} catch (e) { grantA = `${e.name}: ${e.message}`; }
say('grant-A', grantA);
await session.close();
const b = await openSession({ sessionId, writerId: 'writer-b' });
const viewsB = b.session.authority.taskViews();
out.coldReopenEqual = JSON.stringify(viewsB) === JSON.stringify(tsViews);
say('cold-reopen writer-b', { equal: out.coldReopenEqual, outbox: b.session.authority.extensionOutbox().map((r) => r.recordId) });
let grantB;
try {
  grantB = b.session.authority.issueOperationGrant({
    domain: 'monitor_run', recordId: 'monitor-1', ownerId: 'owner-1', workspaceGeneration: '1', phases: ['observe'], leaseDurationMs: 60000,
  });
} catch (e) { grantB = `${e.name}: ${e.message}`; }
say('grant-B (monitor-1 is cancelled with no delivery)', grantB);
await b.session.close();
say('summary', out);
