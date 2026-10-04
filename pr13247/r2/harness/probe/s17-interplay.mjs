// VERIFICATION RIG ONLY (PR #13247 R2) S17: cancel / rename / later Turn against an open cwd operation (claim held 4 s).
import { api, Report, register, createSession, waitTurn, turnRow, sleep, j, sql } from './lib.mjs';
import { pubChange, opId, waitCwdOp, binding, mkdirWs, ctxEvents } from './cwd.mjs';
const R = new Report(process.env.NAME ?? 's17-interplay');
const tag = Date.now() % 100000;
const WS = `ws-s17-${tag}`;
register(WS, 'st-c');
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const mk = async () => { const c = await createSession('public', WS, 'PLAIN'); await waitTurn(c.session); return c.session; };
const open = async (s, n) => { mkdirWs('c', `trap-claim-s17-${n}-${tag}`); const a = await pubChange(s, `trap-claim-s17-${n}-${tag}`, binding(s).rev, { key: `s17-${n}-${tag}` }); await sleep(500); return a; };

// 1: later Turn during the open change
{ const s = await mk(); const a = await open(s, 't');
  const sub = await api('POST', `/v1/agents/sessions/${s}/events`, msg('PLAIN'), { key: `s17t-${tag}` });
  const w = await waitCwdOp(s, opId(a));
  R.check('later Turn during the open change → 409 session_context_busy; change completes', sub.status === 409 && sub.json.error?.code === 'session_context_busy' && w.json.status === 'completed', `${sub.status} ${sub.json.error?.code} op=${w.json.status}`);
  const after = await api('POST', `/v1/agents/sessions/${s}/events`, msg('PLAIN'), { key: `s17t2-${tag}` });
  const ta = after.status === 202 ? await waitTurn(s) : null;
  R.check('…and is admitted again once the change settled', after.status === 202 && ta?.status === 'COMPLETED', `${after.status} ${ta?.status}`); }
// 2: cancel of the (finished) last Turn during the open change
{ const s = await mk(); const last = turnRow(s).at(-1)[0]; const a = await open(s, 'c');
  const cancel = await api('POST', `/v1/agents/sessions/${s}/events`, { type: 'agent.session.cancel', turn_id: last }, { key: `s17c-${tag}` });
  const w = await waitCwdOp(s, opId(a));
  const cmd = sql(`SELECT command_status FROM managed_agent_command WHERE session_id='${s}' ORDER BY created_at DESC LIMIT 1`)[0]?.[0];
  R.note('cancel of a finished Turn during the open change', `cancel=${cancel.status} ${cancel.json.error?.code ?? cancel.json.status ?? ''} cmd=${cmd} → op ${w.json.status}/${w.json.failure_code ?? ''} rev=${binding(s).rev}`);
  if (w.json.status === 'failed') { const re = await pubChange(s, `trap-claim-s17-c-${tag}`, binding(s).rev, { key: `s17c2-${tag}` }); const w2 = await waitCwdOp(s, opId(re)); R.check('…the typed failure is re-issuable', w2.json.status === 'completed', `${re.status} ${w2.json.status}`); } }
// 3: rename during the open change, and the reverse
{ const s = await mk(); const a = await open(s, 'r');
  const ren = await api('PATCH', `/v1/agents/sessions/${s}`, { title: `renamed-${tag}` }, { key: `s17r-${tag}` });
  const w = await waitCwdOp(s, opId(a));
  R.check('rename during the open change → 409 session_operation_active; change completes', ren.status === 409 && ren.json.error?.code === 'session_operation_active' && w.json.status === 'completed', `${ren.status} ${ren.json.error?.code} op=${w.json.status}`);
  const ren2 = await api('PATCH', `/v1/agents/sessions/${s}`, { title: `renamed2-${tag}` }, { key: `s17r2-${tag}` });
  R.note('rename after the change settled', `${ren2.status} ${ren2.json.error?.code ?? ren2.json.title ?? ''}`); }
R.done({});
