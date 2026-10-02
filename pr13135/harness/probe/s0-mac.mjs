// VERIFICATION RIG ONLY (PR #13135): macOS default (non-durable) deployment.
// Bound files/1 close must stay unavailable (capability false, close refused); unbound close keeps working.
import { Report, api, createSession, closeSession, opIdOf, waitTurn, waitOp, getSession, sessStatus, ensureWorkspace, readWs, j, sleep } from './lib.mjs';

const ARM = process.env.ARM ?? 'head';
const rep = new Report(`s0-mac-${ARM}`);
const WS = process.env.WS ?? 'ws-a', ST = process.env.ST ?? 'a';
ensureWorkspace(WS, `st-${ST}`);

for (const surface of ['public', 'web']) {
  const c = await createSession(surface, WS, `G_FILES name=proof-${surface}.txt tag=${surface}`);
  rep.check(`${surface}: bound Session admitted`, c.status === 202, `status=${c.status} session=${c.session}`);
  const t = await waitTurn(c.session);
  rep.check(`${surface}: bound file Turn completes`, t.status === 'COMPLETED', `${t.status} ${t.error} ${t.ms}ms file=${readWs(ST, `child/proof-${surface}.txt`)}`);
  const g = await getSession(c.session);
  const caps = g.json.capabilities ?? {};
  rep.note(`${surface}: capabilities`, j(caps));
  rep.check(`${surface}: session_close is false without durable local-process`, caps.session_close === false || caps.session_close === undefined, `session_close=${caps.session_close} session_lifecycle=${caps.session_lifecycle}`);
  const r = await closeSession(surface, c.session, { key: `close-${surface}` });
  rep.check(`${surface}: bound close refused`, r.status === 409, `status=${r.status} body=${j(r.json).slice(0, 300)}`);
  rep.check(`${surface}: Session stays ACTIVE after refusal`, sessStatus(c.session) === 'ACTIVE', `status=${sessStatus(c.session)}`);
}

// Unbound Session: close keeps working on this deployment.
const u = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'PLAIN hello' }] }, { key: `u-${Date.now()}` });
const us = u.json.id;
rep.check('unbound Session admitted', u.status === 202, `status=${u.status} session=${us}`);
const ut = await waitTurn(us);
rep.check('unbound Turn completes', ut.status === 'COMPLETED', `${ut.status} ${ut.error}`);
const ug = await getSession(us);
rep.note('unbound capabilities', j(ug.json.capabilities));
const uc = await closeSession('public', us, { key: 'close-unbound' });
rep.check('unbound close admitted', uc.status === 202, `status=${uc.status} body=${j(uc.json).slice(0, 200)}`);
const uo = await waitOp(us, opIdOf('public', uc));
rep.check('unbound close completes, Session CLOSED', uo.json.status === 'completed' && sessStatus(us) === 'CLOSED', `op=${uo.json.status} ${uo.ms}ms session=${sessStatus(us)}`);
rep.done();
