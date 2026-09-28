// S1: G0 happy path (REST + WebShell adapter), replay, rejection matrix,
// later-operation gates, unbound regression, wire evidence.
import fs from 'node:fs';
import { R, api, sql, one, register, modelCalls, tapEntries, waitTurn, g0Rest, g0WebShell, out, TENANT } from './lib.mjs';

const ARM = process.env.ARM ?? 'pr';
const res = { arm: ARM, steps: [] };
const log = (name, v) => {
  res.steps.push({ name, ...v });
  console.log(name, JSON.stringify(v));
};

for (const s of 'abcdefgh') for (const f of ['proof.txt']) fs.rmSync(`${R}/roots/${s}/child/${f}`, { force: true });
register('ws-a', 'st-a');
register('ws-b', 'st-b');
register('ws-ro', 'st-c', { canCreate: false });
register('ws-drain', 'st-d', { state: 'DRAINING' });
register('ws-unmounted', 'st-zz');
register('ws-cfg', 'st-e', { config: 'unsupported/1' });
register('ws-f', 'st-f');

// 1) REST create with initial input in ws-a
let m0 = modelCalls();
const rest = await api('POST', '/v1/agents/sessions', g0Rest('ws-a', 'G0_FILES'), { key: 'rest-1' });
log('rest.create', { status: rest.status, id: rest.json.id, turn: rest.json.turn_id ?? rest.json.turn?.id, code: rest.json.error?.code });
const restSession = rest.json.id;
if (restSession) {
  const w = await waitTurn(restSession, { timeoutMs: 90_000 });
  const file = fs.existsSync(`${R}/roots/a/child/proof.txt`) ? fs.readFileSync(`${R}/roots/a/child/proof.txt`, 'utf8') : null;
  log('rest.turn', {
    turn: w.rows[0], ms: w.ms, file,
    decoyTouched: fs.readdirSync(`${R}/decoy`).filter((n) => !n.startsWith('.')),
    journalWorkspace: one(`SELECT workspace_id FROM qwen_managed_session_journal_head WHERE session_id='${restSession}'`),
    toolExecutions: one(`SELECT COUNT(*) FROM qwen_tool_execution WHERE harness_session_id='${restSession}'`),
    terminalEvents: one(`SELECT COUNT(*) FROM managed_agent_event WHERE session_id='${restSession}' AND terminal=TRUE`),
    modelCalls: modelCalls() - m0,
  });
  const ev = await api('GET', `/v1/agents/sessions/${restSession}/events`);
  log('rest.events', { status: ev.status, types: (ev.json.data ?? []).map((e) => e.type), hasDone: JSON.stringify(ev.json).includes('G0_DONE') });
  const turns = await api('GET', `/v1/agents/sessions/${restSession}/turns`);
  log('rest.turns', { status: turns.status, turns: (turns.json.data ?? []).map((t) => ({ id: t.id, status: t.status })) });
  // replay + conflict
  const m1 = modelCalls();
  const replay = await api('POST', '/v1/agents/sessions', g0Rest('ws-a', 'G0_FILES'), { key: 'rest-1' });
  log('rest.replay', { status: replay.status, sameSession: replay.json.id === restSession, turnCount: one(`SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='${restSession}'`), extraModelCalls: modelCalls() - m1, toolExecutions: one(`SELECT COUNT(*) FROM qwen_tool_execution WHERE harness_session_id='${restSession}'`) });
  const changed = await api('POST', '/v1/agents/sessions', g0Rest('ws-a', 'CHANGED'), { key: 'rest-1' });
  log('rest.changedInput', { status: changed.status, code: changed.json.error?.code });
  // later operations
  const t = one(`SELECT turn_id FROM managed_agent_turn WHERE session_id='${restSession}'`);
  const gates = {
    submit: await api('POST', `/v1/agents/sessions/${restSession}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'again' }] }, { key: 'later-1' }),
    cancel: await api('POST', `/v1/agents/sessions/${restSession}/events`, { type: 'agent.session.cancel', turn_id: t }, { key: 'later-2' }),
    rename: await api('PATCH', `/v1/agents/sessions/${restSession}`, { title: 'x' }, { key: 'later-3' }),
    close: await api('POST', `/v1/agents/sessions/${restSession}/close`, {}, { key: 'later-4' }),
    archive: await api('POST', `/v1/agents/sessions/${restSession}/archive`, {}, { key: 'later-5' }),
    delete: await api('DELETE', `/v1/agents/sessions/${restSession}`, undefined, { key: 'later-6' }),
    otherActorGet: await api('GET', `/v1/agents/sessions/${restSession}`, undefined, { actor: 'mallory' }),
  };
  log('rest.laterOps', Object.fromEntries(Object.entries(gates).map(([k, v]) => [k, `${v.status} ${v.json.error?.code ?? ''}`.trim()])));
}

// 2) WebShell adapter create in ws-b
m0 = modelCalls();
const ws = await api('POST', '/api/agent/web-shell/v1/sessions/create', g0WebShell('ws-b', 'webshell-1', 'G0_FILES'), { key: 'webshell-1' });
log('webshell.create', { status: ws.status, id: ws.json.sessionId, code: ws.json.error?.code ?? ws.json.code });
const wsSession = ws.json.sessionId;
if (wsSession) {
  const w = await waitTurn(wsSession, { timeoutMs: 90_000 });
  log('webshell.turn', {
    turn: w.rows[0], ms: w.ms,
    file: fs.existsSync(`${R}/roots/b/child/proof.txt`) ? fs.readFileSync(`${R}/roots/b/child/proof.txt`, 'utf8') : null,
    journalWorkspace: one(`SELECT workspace_id FROM qwen_managed_session_journal_head WHERE session_id='${wsSession}'`),
    toolExecutions: one(`SELECT COUNT(*) FROM qwen_tool_execution WHERE harness_session_id='${wsSession}'`),
    terminalEvents: one(`SELECT COUNT(*) FROM managed_agent_event WHERE session_id='${wsSession}' AND terminal=TRUE`),
    modelCalls: modelCalls() - m0,
  });
  const m1 = modelCalls();
  const replay = await api('POST', '/api/agent/web-shell/v1/sessions/create', g0WebShell('ws-b', 'webshell-1', 'G0_FILES'), { key: 'webshell-1' });
  log('webshell.replay', { status: replay.status, sameSession: replay.json.sessionId === wsSession, extraModelCalls: modelCalls() - m1 });
  const tr = await api('POST', '/api/agent/web-shell/v1/transcript/query', { sessionId: wsSession });
  log('webshell.transcript', { status: tr.status, bytes: JSON.stringify(tr.json).length, hasTools: ['write_file', 'edit', 'read_file'].map((n) => JSON.stringify(tr.json).includes(n)) });
  const sub = await api('POST', '/api/agent/web-shell/v1/turns/submit', { sessionId: wsSession, idempotencyKey: 'ws-later', input: [{ type: 'input_text', text: 'again' }] }, { key: 'ws-later' });
  log('webshell.submit', { status: sub.status, code: sub.json.error?.code ?? sub.json.code });
}

// 3) rejection matrix, with input vs. empty input
const cases = {
  noActor: ['ws-f', { actor: null }],
  otherActor: ['ws-f', { actor: 'bob' }],
  unknownWs: ['ws-nope', {}],
  draining: ['ws-drain', {}],
  unmounted: ['ws-unmounted', {}],
  unsupportedConfig: ['ws-cfg', {}],
  readOnly: ['ws-ro', {}],
};
const matrix = {};
let n = 0;
for (const [name, [wsId, opts]] of Object.entries(cases)) {
  const withInput = await api('POST', '/v1/agents/sessions', g0Rest(wsId, 'G0_FILES'), { key: `neg-in-${n}`, ...opts });
  const empty = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: wsId, cwd_relative: 'child' } }, { key: `neg-empty-${n++}`, ...opts });
  matrix[name] = { withInput: `${withInput.status} ${withInput.json.error?.code ?? ''}`.trim(), empty: `${empty.status} ${empty.json.error?.code ?? ''}`.trim() };
}
const other = await api('POST', '/v1/agents/sessions', { ...g0Rest('ws-f', 'G0_FILES'), agent_id: 'another-agent' }, { key: 'neg-agent' });
matrix.otherAgent = { withInput: `${other.status} ${other.json.error?.code ?? ''}`.trim() };
const prof = await api('POST', '/v1/agents/sessions', { ...g0Rest('ws-f', 'G0_FILES'), metadata: { toolProfile: 'hosted-workspace-shell/1' } }, { key: 'neg-profile' });
matrix.metadataProfile = { withInput: `${prof.status} ${prof.json.error?.code ?? ''}`.trim() };
log('matrix', matrix);

// 4) unbound legacy Session with input (no Workspace): no-tool path unchanged
m0 = modelCalls();
const legacy = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'hello legacy' }] }, { key: 'legacy-1', actor: null });
const legacyId = legacy.json.id;
if (legacyId) {
  const w = await waitTurn(legacyId, { timeoutMs: 90_000 });
  const lastModel = fs.readFileSync(process.env.MODEL_LOG ?? `${R}/run/model-requests.jsonl`, 'utf8').trim().split('\n').at(-1);
  log('legacy', { status: legacy.status, turn: w.rows[0], journalWorkspace: one(`SELECT workspace_id FROM qwen_managed_session_journal_head WHERE session_id='${legacyId}'`), modelCalls: modelCalls() - m0, lastModelTools: JSON.parse(lastModel).tools });
} else log('legacy', { status: legacy.status, code: legacy.json.error?.code });

// 5) wire evidence: create/load bodies Spring sent to the Harness
const wire = tapEntries()
  .filter((e) => e.method === 'POST' && /\/session(\/[^/]+\/load)?$/.test(e.path))
  .map((e) => ({ path: e.path.replace(/[0-9a-f-]{36}/, ':id'), status: e.status, sessionId: e.body?.sessionId ?? e.path.split('/')[2], toolProfile: e.body?.toolProfile ?? null, storeWorkspaceId: e.body?.managedSessionStore?.workspaceId }));
log('wire', { sessions: { rest: restSession, webshell: wsSession, legacy: legacyId }, wire });
out(`s1-${ARM}.json`, res);
