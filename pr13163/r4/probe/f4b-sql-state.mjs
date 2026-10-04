// VERIFICATION RIG ONLY (PR #13163): triage F4 on a bound Session. This macOS rig cannot run a bound close
// (durable local-process is Linux-only, close answers 409 workspace_unavailable), so the CLOSED / DELETED states a
// real close / delete would leave are written by SQL after the Turn ended. Then the creator's cancel (and a submit)
// are posted against the old Turn id.
// usage: DB=<db> node f4b-sql-state.mjs <workspace> <storage>
import { api, sql, one, register, waitTurn, turnRow, Report, sleep, TENANT, j } from './lib.mjs';
const [WS, ST] = [process.argv[2], process.argv[3]];
const r = new Report(`f4b-sql-state-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${WS}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const cmds = (S) => Number(one(`SELECT COUNT(*) FROM managed_agent_command WHERE session_id='${S}'`));
const turns = (S) => Number(one(`SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='${S}'`));
const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=f4b.txt tag=b0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('c') });
const S = c.json.id;
await waitTurn(S, { timeoutMs: 90_000 });
const t = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_HOLD'), { actor: 'alice', key: k('hold') });
const T = t.json.turn_id;
await waitTurn(S, { timeoutMs: 15_000, until: ['RUNNING'] });
const cx = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: T }, { actor: 'alice', key: k('live') });
const end = await waitTurn(S, { timeoutMs: 60_000 });
r.note('live cancel', `${cx.status} -> ${end.status}`);
await sleep(1500);
const out = { S, live: [cx.status, end.status] };
for (const [label, set] of [['CLOSED', "status='CLOSED'"], ['ARCHIVED', "status='ARCHIVED'"], ['DELETED', `status='DELETED', deleted_at=${Date.now()}`]]) {
  sql(`UPDATE managed_agent_session SET ${set} WHERE session_id='${S}'`);
  const get = await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice' });
  const c0 = cmds(S), t0 = turns(S);
  const cc = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: T }, { actor: 'alice', key: k(`cancel-${label}`) });
  const wc = await api('POST', '/api/agent/web-shell/v1/turns/cancel', { sessionId: S, turnId: T, idempotencyKey: k(`wcancel-${label}`) }, { actor: 'alice' });
  const mc = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: T }, { actor: 'mallory', key: k(`m-${label}`) });
  const sub = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_FILES name=f4b.txt tag=b9'), { actor: 'alice', key: k(`sub-${label}`) });
  r.note(`${label}: GET / creator cancel (public, WebShell) / mallory cancel / creator submit`, `${get.status} / ${cc.status} ${cc.json.error?.code ?? cc.json.status ?? ''}, ${wc.status} ${wc.json.error?.code ?? wc.json.status ?? ''} / ${mc.status} ${mc.json.error?.code ?? ''} / ${sub.status} ${sub.json.error?.code ?? ''}; command rows +${cmds(S) - c0}, Turn rows +${turns(S) - t0}`);
  out[label] = { get: get.status, cancel: [cc.status, cc.json.error?.code ?? cc.json.status], web: [wc.status, wc.json.error?.code ?? wc.json.status], mallory: [mc.status, mc.json.error?.code], submit: [sub.status, sub.json.error?.code], rows: cmds(S) - c0, turnRows: turns(S) - t0 };
}
sql(`UPDATE managed_agent_session SET status='ACTIVE', deleted_at=NULL WHERE session_id='${S}'`);
r.note('Turn history', j(turnRow(S)));
r.done(out);
process.exit(0);
