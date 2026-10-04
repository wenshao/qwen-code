// VERIFICATION RIG ONLY (PR #13163): triage F4. requireCanceller no longer checks the Session lifecycle
// (ACTIVE / not deleted) that base's requireSubmitter did. Can a live cancel ever meet a non-ACTIVE Session, and what
// does a cancel answer (and write) once the Session is CLOSED or DELETED? Unbound Session is the control.
// usage: DB=<db> node f4-lifecycle.mjs <workspace> <storage>
import { api, sql, one, register, waitTurn, waitOp, turnRow, Report, sleep, TENANT, j } from './lib.mjs';
const [WS, ST] = [process.argv[2], process.argv[3]];
const r = new Report(`f4-lifecycle-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${WS}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const cmds = (S) => Number(one(`SELECT COUNT(*) FROM managed_agent_command WHERE session_id='${S}'`));
const status = (S) => one(`SELECT CONCAT(status, ' deleted_at=', COALESCE(deleted_at,'null')) FROM managed_agent_session WHERE session_id='${S}'`);
const out = {};
for (const kind of ['bound', 'unbound']) {
  const body = { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=f4.txt tag=f0' }], ...(kind === 'bound' ? { workspace: { workspace_id: WS, cwd_relative: 'child' } } : {}) };
  const c = await api('POST', '/v1/agents/sessions', body, { actor: 'alice', key: k(`c-${kind}`) });
  const S = c.json.id;
  await waitTurn(S, { timeoutMs: 90_000 });
  const t = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_HOLD'), { actor: 'alice', key: k('hold') });
  const T = t.json.turn_id;
  await waitTurn(S, { timeoutMs: 15_000, until: ['RUNNING'] });
  const closeLive = await api('POST', `/v1/agents/sessions/${S}/close`, {}, { actor: 'alice', key: k('close-live') });
  const delLive = await api('DELETE', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice', key: k('del-live') });
  r.note(`${kind}: close / delete while the Turn runs`, `${closeLive.status} ${closeLive.json.error?.code ?? closeLive.json.status} / ${delLive.status} ${delLive.json.error?.code ?? delLive.json.status}; session ${status(S)}`);
  const cx = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: T }, { actor: 'alice', key: k('cancel-live') });
  const end = await waitTurn(S, { timeoutMs: 60_000 });
  r.note(`${kind}: live cancel`, `${cx.status} -> ${end.status}`);
  await sleep(1500);
  const close = await api('POST', `/v1/agents/sessions/${S}/close`, {}, { actor: 'alice', key: k('close') });
  const cop = close.json.id ?? close.json.operation_id;
  const cw = cop ? await waitOp(S, cop, { timeoutMs: 60_000 }) : null;
  r.note(`${kind}: close after the Turn ended`, `${close.status} ${close.json.error?.code ?? ''} op=${cw?.json.status ?? '-'}; session ${status(S)}`);
  const c0 = cmds(S);
  const cc = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: T }, { actor: 'alice', key: k('cancel-closed') });
  r.note(`${kind}: cancel on the CLOSED Session`, `${cc.status} ${cc.json.error?.code ?? cc.json.status ?? ''}; command rows +${cmds(S) - c0}`);
  const del = await api('DELETE', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice', key: k('del') });
  const dop = del.json.id ?? del.json.operation_id;
  const dw = dop ? await waitOp(S, dop, { timeoutMs: 60_000 }) : null;
  const get = await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice' });
  r.note(`${kind}: delete`, `${del.status} ${del.json.error?.code ?? ''} op=${dw?.json.status ?? '-'}; session ${status(S)}; GET ${get.status} ${get.json.error?.code ?? ''}`);
  const d0 = cmds(S);
  const cd = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: T }, { actor: 'alice', key: k('cancel-deleted') });
  const sub = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_FILES name=f4.txt tag=f9'), { actor: 'alice', key: k('submit-deleted') });
  r.note(`${kind}: cancel / submit on the DELETED Session`, `${cd.status} ${cd.json.error?.code ?? cd.json.status ?? ''} / ${sub.status} ${sub.json.error?.code ?? ''}; command rows +${cmds(S) - d0}`);
  r.note(`${kind}: Turn history`, j(turnRow(S)));
  out[kind] = { S, closeLive: [closeLive.status, closeLive.json.error?.code], delLive: [delLive.status, delLive.json.error?.code], live: [cx.status, end.status], close: [close.status, close.json.error?.code, cw?.json.status], cancelClosed: [cc.status, cc.json.error?.code ?? cc.json.status], closedRows: cmds(S) - c0, del: [del.status, del.json.error?.code, dw?.json.status], get: get.status, cancelDeleted: [cd.status, cd.json.error?.code ?? cd.json.status], submitDeleted: [sub.status, sub.json.error?.code] };
}
r.done(out);
process.exit(0);
