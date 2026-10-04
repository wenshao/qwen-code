// VERIFICATION RIG ONLY (PR #13247 R2) S19: which open rows block what (R2-4). States are SQL-seeded on real Sessions:
// a stuck PENDING rename command, and an open ACTION_RESPONSE operation.
import { api, Report, register, createSession, waitTurn, j, sql, TENANT } from './lib.mjs';
import { pubChange, opId, waitCwdOp, binding, mkdirWs } from './cwd.mjs';
const R = new Report(process.env.NAME ?? 's19-barrier-population');
const tag = Date.now() % 100000;
const WS = `ws-s19-${tag}`;
register(WS, 'st-d');
mkdirWs('d', 'child2');
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const mk = async () => { const c = await createSession('public', WS, 'PLAIN'); await waitTurn(c.session); return c.session; };
const now = Date.now();
// 1: stuck PENDING rename command
{ const s = await mk();
  sql(`INSERT INTO managed_agent_command (tenant_id, operation, idempotency_key, request_digest, session_id, created_at, command_status, updated_at, session_status_before) VALUES ('${TENANT}','RENAME','rig-stuck-${tag}','d','${s}',${now},'PENDING',${now},'ACTIVE')`);
  const t = await api('POST', `/v1/agents/sessions/${s}/events`, msg('PLAIN'), { key: `s19t-${tag}` });
  const tw = t.status === 202 ? await waitTurn(s) : null;
  const c = await pubChange(s, 'child2', 1, { key: `s19c-${tag}` });
  R.check('stuck PENDING rename: later Turn admitted (barrier ignores display mutations); cwd change refused 409 session_context_busy', t.status === 202 && tw?.status === 'COMPLETED' && c.status === 409 && c.json.error?.code === 'session_context_busy', `turn=${t.status} ${tw?.status ?? t.json.error?.code} cwd=${c.status} ${c.json.error?.code}`);
  sql(`UPDATE managed_agent_command SET command_status='FAILED' WHERE idempotency_key='rig-stuck-${tag}'`);
  const c2 = await pubChange(s, 'child2', 1, { key: `s19c2-${tag}` }); const w2 = c2.status === 202 ? await waitCwdOp(s, opId(c2)) : c2;
  R.check('…released once the command is no longer PENDING', w2.json.status === 'completed', `${c2.status} ${w2.json.status ?? w2.json.error?.code}`); }
// 2: open ACTION_RESPONSE operation
{ const s = await mk();
  sql(`INSERT INTO managed_agent_operation (tenant_id, session_id, operation_id, operation_kind, actor_digest, idempotency_key, request_digest, state, admission_stage, delivery_state, session_status_before, available_at, created_at, updated_at) VALUES ('${TENANT}','${s}','op_rig_ar_${tag}','ACTION_RESPONSE','a','k-${tag}','d','PENDING','JAVA_DURABLE','BLOCKED','ACTIVE',${now + 86400000},${now},${now})`);
  const t = await api('POST', `/v1/agents/sessions/${s}/events`, msg('PLAIN'), { key: `s19t2-${tag}` });
  const tw = t.status === 202 ? await waitTurn(s) : null;
  const c = await pubChange(s, 'child2', 1, { key: `s19c3-${tag}` });
  R.check('open ACTION_RESPONSE operation: later Turn admitted; cwd change refused 409 session_context_busy', t.status === 202 && tw?.status === 'COMPLETED' && c.status === 409 && c.json.error?.code === 'session_context_busy', `turn=${t.status} ${tw?.status ?? t.json.error?.code} cwd=${c.status} ${c.json.error?.code}`); }
R.done({});
