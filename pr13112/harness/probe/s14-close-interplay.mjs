// VERIFICATION RIG ONLY (PR #13112 round 5): this PR's later Turns meet main's bound-Session close (#13135).
// usage: DB=<db> node s14-close-interplay.mjs <workspace> <storage>
import { spawnSync } from 'node:child_process';
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, modelEntries, Report, sleep, TENANT, j } from './lib.mjs';

const [WS, ST] = [process.argv[2] ?? 'ws-a', process.argv[3] ?? 'a'];
const r = new Report(`s14-close-interplay-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${WS}-${Date.now()}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const create = async (text) => {
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
  const t = await waitTurn(c.json.id, { timeoutMs: 90_000 });
  return { S: c.json.id, t };
};
async function waitOpDone(S, op, ms = 60_000) {
  const start = Date.now();
  for (;;) {
    const g = await api('GET', `/v1/agents/sessions/${S}/operations/${op}`, undefined, { actor: 'alice' });
    if (['completed', 'failed'].includes(g.json.status) || Date.now() - start > ms) return { ...g.json, ms: Date.now() - start };
    await sleep(300);
  }
}
const binding = (S) => j(sql(`SELECT DISTINCT b.binding_state, b.runtime_endpoint FROM qwen_runtime_session s JOIN qwen_runtime_binding b ON b.binding_id=s.binding_id WHERE s.harness_session_id='${S}'`));
const workerUp = (S) => {
  const e = sql(`SELECT DISTINCT b.runtime_endpoint FROM qwen_runtime_session s JOIN qwen_runtime_binding b ON b.binding_id=s.binding_id WHERE s.harness_session_id='${S}'`).flat()[0];
  if (!e) return 'no binding';
  const port = new URL(e).port;
  return spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).stdout.trim() ? `listening on ${port}` : `nothing on ${port}`;
};

// B. who may close
const { S: B } = await create('G_FILES name=closeb.txt tag=b0');
for (const [actor, want] of [['carol', 403], ['bob', 403], ['mallory', 404]]) {
  const x = await api('POST', `/v1/agents/sessions/${B}/close`, {}, { actor, key: k(`close-${actor}`) });
  r.check(`B. close by ${actor} -> ${want}`, x.status === want, `${x.status} ${x.json.error?.code ?? ''}`);
}

// A. close while the creator's later Turn is running
const { S: A } = await create('G_FILES name=closea.txt tag=a0');
const before = executions(A);
const hold = await api('POST', `/v1/agents/sessions/${A}/events`, msg('G_HOLD tag=close-hold'), { actor: 'alice', key: k('hold') });
for (let i = 0; i < 200 && !modelEntries().some((e) => e.kind === 'HOLD' && e.tag === 'close-hold'); i++) await sleep(100);
r.note('A. worker before close', workerUp(A));
const close = await api('POST', `/v1/agents/sessions/${A}/close`, {}, { actor: 'alice', key: k('close-a') });
r.check('A. creator closes while a later Turn runs -> 202', close.status === 202, `${close.status} ${j(close.json).slice(0, 200)}`);
const op = close.json.id ?? close.json.operation_id;
const done = op ? await waitOpDone(A, op) : null;
r.note('A. close operation outcome', j(done && { status: done.status, error: done.error, ms: done.ms }));
const ta = await waitTurn(A, { timeoutMs: 30_000 });
const ab = modelEntries().find((e) => e.kind === 'HOLD-aborted' && e.tag === 'close-hold');
r.note('A. held Turn after close', `${j(ta)} modelAborted=${!!ab}${ab ? ` after ${ab.heldMs} ms` : ''} executions ${before} -> ${executions(A)}`);
r.note('A. session / lease / binding / worker', `status=${one(`SELECT status FROM managed_agent_session WHERE session_id='${A}'`)} lease=${j(sql(`SELECT COALESCE(holder_key,'<null>') FROM managed_workspace_execution_lease`).flat())} binding=${binding(A)} worker=${workerUp(A)}`);
const caps = (await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: A }, { actor: 'alice' })).json.capabilities;
const later = await api('POST', `/v1/agents/sessions/${A}/events`, msg('PLAIN after close'), { actor: 'alice', key: k('after') });
const rn = await api('PATCH', `/v1/agents/sessions/${A}`, { title: 'after close' }, { actor: 'alice', key: k('rn') });
r.note('A. after close: capability / later Turn / rename', `workspaceTurns=${caps?.workspaceTurns} sessionClose=${caps?.sessionClose} submit=${later.status} ${later.json.error?.code ?? ''} rename=${rn.status} ${rn.json.error?.code ?? ''}`);

// C. F2 state (worker crashed, binding LOST) -> can the creator at least close it?
const { S: C } = await create('G_FILES name=closec.txt tag=c0');
const e = sql(`SELECT DISTINCT b.runtime_endpoint FROM qwen_runtime_session s JOIN qwen_runtime_binding b ON b.binding_id=s.binding_id WHERE s.harness_session_id='${C}'`).flat()[0];
const pid = spawnSync('lsof', ['-nP', `-iTCP:${new URL(e).port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).stdout.trim();
const cmd = spawnSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).stdout.trim();
if (/managed-runtime-worker/.test(cmd) && /pr13112-rig/.test(cmd)) process.kill(Number(pid), 'SIGKILL');
await sleep(1500);
const lt = await api('POST', `/v1/agents/sessions/${C}/events`, msg('G_FILES name=closec.txt tag=c1'), { actor: 'alice', key: k('c1') });
r.note('C. later Turn after the worker died (F2)', `${lt.status} ${j(await waitTurn(C, { timeoutMs: 60_000 }))} binding=${binding(C)}`);
const cc = await api('POST', `/v1/agents/sessions/${C}/close`, {}, { actor: 'alice', key: k('close-c') });
const cdone = cc.json.id ? await waitOpDone(C, cc.json.id) : null;
r.note('C. creator closes the stuck Session', `${cc.status} op=${j(cdone && { status: cdone.status, error: cdone.error, ms: cdone.ms })} session=${one(`SELECT status FROM managed_agent_session WHERE session_id='${C}'`)}`);
r.done({ A, B, C });
