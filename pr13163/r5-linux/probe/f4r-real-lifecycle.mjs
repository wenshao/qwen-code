// VERIFICATION RIG ONLY (PR #13163 R5): triage F4 through the REAL lifecycle API (Linux, durable local process).
// A bound Session's Turn is cancelled live, then the Session is really closed, archived and deleted through the public
// routes. After each step the creator's cancel (public + WebShell) of the old Turn, a stranger's cancel and a submit
// are posted; command/Turn row deltas are counted.
// usage: DB=<db> node f4r-real-lifecycle.mjs <workspace> <storage>
import { api, sql, one, register, waitTurn, turnRow, Report, sleep, TENANT, j } from './lib.mjs';
const [WS, ST] = [process.argv[2], process.argv[3]];
const r = new Report(`f4r-real-lifecycle-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${WS}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const cmds = (S) => Number(one(`SELECT COUNT(*) FROM managed_agent_command WHERE session_id='${S}'`));
const turns = (S) => Number(one(`SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='${S}'`));
const status = (S) => one(`SELECT CONCAT(status, '/', IF(deleted_at IS NULL, 'live', 'deleted')) FROM managed_agent_session WHERE session_id='${S}'`);
async function waitOp(S, op, ms = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const g = await api('GET', `/v1/agents/sessions/${S}/operations/${op}`, undefined, { actor: 'alice' });
    if (['completed', 'failed'].includes(g.json.status) || Date.now() - t0 > ms) return g;
    await sleep(300);
  }
}
const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=f4r.txt tag=r0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('c') });
const S = c.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const t = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_HOLD tag=f4r'), { actor: 'alice', key: k('hold') });
const T = t.json.turn_id;
await waitTurn(S, { timeoutMs: 20_000, until: ['RUNNING'] });
await sleep(1500);
const closeRunning = await api('POST', `/v1/agents/sessions/${S}/close`, {}, { actor: 'alice', key: k('close-running') });
r.note('close while the Turn runs', `${closeRunning.status} ${closeRunning.json.error?.code ?? closeRunning.json.status ?? ''}`);
const cx = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: T }, { actor: 'alice', key: k('live') });
const end = await waitTurn(S, { timeoutMs: 60_000 });
r.check('live cancel ends the Turn CANCELLED', end.status === 'CANCELLED', `${cx.status} -> ${end.status} ${end.error}`);
await sleep(1500);
const out = { S, T, closeRunning: [closeRunning.status, closeRunning.json.error?.code], live: [cx.status, end.status] };
const steps = [
  ['CLOSED', () => api('POST', `/v1/agents/sessions/${S}/close`, {}, { actor: 'alice', key: k('close') })],
  ['ARCHIVED', () => api('POST', `/v1/agents/sessions/${S}/archive`, {}, { actor: 'alice', key: k('archive') })],
  ['DELETED', () => api('DELETE', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice', key: k('delete') })],
];
for (const [label, run] of steps) {
  const op = await run();
  const opId = op.json.operation_id ?? op.json.id;
  const done = opId ? await waitOp(S, opId) : null;
  const st = status(S);
  r.note(`${label}: lifecycle call / operation / session row`, `${op.status} ${op.json.error?.code ?? ''} / ${done ? done.json.status + ' ' + (done.json.failure_code ?? '') : '-'} / ${st}`);
  if (op.status >= 300) { out[label] = { lifecycle: [op.status, op.json.error?.code] }; break; }
  const get = await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice' });
  const c0 = cmds(S), t0 = turns(S);
  const cc = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: T }, { actor: 'alice', key: k(`cancel-${label}`) });
  const wc = await api('POST', '/api/agent/web-shell/v1/turns/cancel', { sessionId: S, turnId: T, idempotencyKey: k(`wcancel-${label}`) }, { actor: 'alice' });
  const mc = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: T }, { actor: 'mallory', key: k(`m-${label}`) });
  const sub = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_FILES name=f4r.txt tag=r9'), { actor: 'alice', key: k(`sub-${label}`) });
  r.note(`${label}: GET / creator cancel (public, WebShell) / mallory cancel / creator submit`, `${get.status} / ${cc.status} ${cc.json.error?.code ?? cc.json.status ?? ''}, ${wc.status} ${wc.json.error?.code ?? wc.json.status ?? ''} / ${mc.status} ${mc.json.error?.code ?? ''} / ${sub.status} ${sub.json.error?.code ?? ''}; command rows +${cmds(S) - c0}, Turn rows +${turns(S) - t0}`);
  out[label] = { lifecycle: [op.status, done?.json.status], session: st, get: get.status, cancel: [cc.status, cc.json.error?.code ?? cc.json.status], web: [wc.status, wc.json.error?.code ?? wc.json.status], mallory: [mc.status, mc.json.error?.code], submit: [sub.status, sub.json.error?.code], rows: cmds(S) - c0, turnRows: turns(S) - t0 };
}
r.note('Turn history', j(turnRow(S)));
r.done(out);
process.exit(0);
