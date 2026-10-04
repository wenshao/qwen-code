// VERIFICATION RIG ONLY (PR #13247 R2) S14: permission Actions vs the cwd gate. Spring must run with approval mode "default".
import { api, Report, register, createSession, waitTurn, turnRow, sleep, j, sql, one, listActions, respond, waitPending } from './lib.mjs';
import { pubChange, opId, waitCwdOp, binding, mkdirWs } from './cwd.mjs';

const R = new Report(process.env.NAME ?? 's14-actions');
const tag = Date.now() % 100000;
const WS = `ws-s14-${tag}`;
register(WS, 'st-b');
mkdirWs('b', 'child2');
const actionRows = (s) => sql(`SELECT action_id, state, CAST(JSON_EXTRACT(options_json,'$.expiresAt') AS UNSIGNED) - CAST(UNIX_TIMESTAMP(NOW(3))*1000 AS UNSIGNED) FROM managed_agent_action WHERE session_id='${s}' ORDER BY created_at`);
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });

// A: cancel while the approval waits
{
  const c = await createSession('public', WS, `G_WRITE name=a-${tag}.txt content=a`);
  const p = await waitPending(c.session, { timeoutMs: 40_000 });
  R.note('A: Action requested', `${p.timeout ? 'TIMEOUT' : p.action.id ?? p.action.actionId} rows=${j(actionRows(c.session))}`);
  const busy = await pubChange(c.session, 'child2', 1, { key: `s14a-${tag}` });
  R.check('A: cwd change while the approval waits → 409 session_context_busy', busy.status === 409 && busy.json.error?.code === 'session_context_busy', `${busy.status} ${busy.json.error?.code}`);
  const t = turnRow(c.session).at(-1);
  const cancel = await api('POST', `/v1/agents/sessions/${c.session}/events`, { type: 'agent.session.cancel', turn_id: t[0] }, { key: `s14ac-${tag}` });
  const tw = await waitTurn(c.session, { timeoutMs: 40_000 });
  await sleep(500);
  const rows = actionRows(c.session);
  const after = await pubChange(c.session, 'child2', 1, { key: `s14a2-${tag}` });
  const w = after.status === 202 ? await waitCwdOp(c.session, opId(after)) : after;
  R.check('A: after the cancel settles, the Action is no longer requested and the change completes', tw.status === 'CANCELLED' && rows.every((r) => r[1] !== 'requested') && w.json.status === 'completed', `cancel=${cancel.status} turn=${tw.status} actions=${j(rows)} change=${after.status} ${w.json.status ?? w.json.error?.code}`);
}

// B: approve, then change
{
  const c = await createSession('public', WS, `G_WRITE name=b-${tag}.txt content=b`);
  const p = await waitPending(c.session, { timeoutMs: 40_000 });
  const r = await respond('public', c.session, p.action, 'allow', { key: `s14br-${tag}` });
  const tw = await waitTurn(c.session, { timeoutMs: 40_000 });
  const a = await pubChange(c.session, 'child2', 1, { key: `s14b-${tag}` });
  const w = a.status === 202 ? await waitCwdOp(c.session, opId(a)) : a;
  R.check('B: approved Action, Turn completes → change completes', r.status === 202 && tw.status === 'COMPLETED' && w.json.status === 'completed', `respond=${r.status} turn=${tw.status} actions=${j(actionRows(c.session))} change=${a.status} ${w.json.status ?? w.json.error?.code}`);
}

// C: a requested Action outliving its Turn (Turn row forced terminal; Action left requested, as after a lost settlement)
{
  const c = await createSession('public', WS, `G_WRITE name=c-${tag}.txt content=c`);
  const p = await waitPending(c.session, { timeoutMs: 40_000 });
  sql(`UPDATE managed_agent_turn SET status='FAILED', error_code='rig_forced' WHERE session_id='${c.session}' AND status NOT IN ('COMPLETED','FAILED','CANCELLED')`);
  const rows = actionRows(c.session);
  const a = await pubChange(c.session, 'child2', 1, { key: `s14c-${tag}` });
  R.check('C: requested, unexpired Action with no active Turn → 409 session_context_busy (R3-1 gate itself)', a.status === 409 && a.json.error?.code === 'session_context_busy', `${a.status} ${a.json.error?.code} actions=${j(rows)}`);
  sql(`UPDATE managed_agent_action SET options_json = JSON_SET(options_json, '$.expiresAt', CAST(UNIX_TIMESTAMP(NOW(3))*1000 - 1000 AS UNSIGNED)) WHERE session_id='${c.session}' AND state='requested'`);
  const a2 = await pubChange(c.session, 'child2', 1, { key: `s14c2-${tag}` });
  const w2 = a2.status === 202 ? await waitCwdOp(c.session, opId(a2)) : a2;
  R.check('C: same Action past expiresAt → change admitted and completes', w2.json.status === 'completed', `${a2.status} ${w2.json.status ?? w2.json.error?.code}`);
}
R.done({});
