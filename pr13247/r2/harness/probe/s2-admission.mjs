// VERIFICATION RIG ONLY (PR #13247) S2: admission matrix over real HTTP (both surfaces), DB side effects.
import { api, Report, ensureWorkspace, register, createSession, waitTurn, sleep, j, sql, one, TENANT, BASE, WS, ST } from './lib.mjs';
import { pubChange, webChange, opId, waitCwdOp, binding, mkdirWs, openOps } from './cwd.mjs';

const R = new Report('s2-admission');
ensureWorkspace(WS, `st-${ST}`);
mkdirWs(ST, 'child2');
const opCount = () => Number(one(`SELECT COUNT(*) FROM managed_agent_operation WHERE operation_kind='CWD_CHANGE'`));
const code = (r) => r.json?.error?.code;
const k = (p) => `s2-${p}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

const c = await createSession('public', WS, 'PLAIN');
const s = c.session;
await waitTurn(s);
const before = opCount();

async function expect(label, r, status, errCode) {
  const ok = r.status === status && (errCode === undefined || code(r) === errCode);
  R.check(`${label} → ${status}${errCode ? ' ' + errCode : ''}`, ok, `${r.status} ${code(r) ?? j(r.json).slice(0, 160)}`);
  return r;
}
const rawPost = async (path, body, headers) => {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const t = await res.text();
  let js; try { js = JSON.parse(t); } catch { js = { raw: t }; }
  return { status: res.status, json: js };
};
const P = `/v1/agents/sessions/${s}/cwd`;
const H = { 'X-Qwen-Tenant-Id': TENANT, 'X-Rig-Actor': 'alice' };

R.say('## identity / syntax (public)');
await expect('no actor (tenant only)', await rawPost(P, { cwd_relative: 'child2', expected_context_revision: 1 }, { 'X-Qwen-Tenant-Id': TENANT, 'Idempotency-Key': k('na') }), 401);
await expect('no tenant, no actor', await rawPost(P, { cwd_relative: 'child2', expected_context_revision: 1 }, { 'Idempotency-Key': k('nt') }), 401);
await expect('missing Idempotency-Key header', await rawPost(P, { cwd_relative: 'child2', expected_context_revision: 1 }, H), 400);
await expect('Idempotency-Key with a space', await pubChange(s, 'child2', 1, { key: 'has space' }), 400, 'invalid_idempotency_key');
await expect('Idempotency-Key 129 chars', await pubChange(s, 'child2', 1, { key: 'x'.repeat(129) }), 400, 'invalid_idempotency_key');
await expect('missing cwd_relative', await pubChange(s, null, null, { key: k('m1'), raw: { expected_context_revision: 1 } }), 400, 'invalid_request');
await expect('missing expected_context_revision', await pubChange(s, null, null, { key: k('m2'), raw: { cwd_relative: 'child2' } }), 400, 'invalid_request');
await expect('expected_context_revision 0', await pubChange(s, 'child2', 0, { key: k('r0') }), 400, 'invalid_request');
await expect('expected_context_revision -1', await pubChange(s, 'child2', -1, { key: k('rn') }), 400, 'invalid_request');
await expect('malformed JSON body', await rawPost(P, '{"cwd_relative":', { ...H, 'Idempotency-Key': k('mj') }), 400);
for (const [label, raw] of [
  ['cwd_relative as number 7', { cwd_relative: 7, expected_context_revision: 1 }],
  ['cwd_relative as array', { cwd_relative: ['child2'], expected_context_revision: 1 }],
  ['expected_context_revision as string "1"', { cwd_relative: 'child2', expected_context_revision: '1' }],
  ['expected_context_revision as float 1.9', { cwd_relative: 'child2', expected_context_revision: 1.9 }],
  ['expected_context_revision as true', { cwd_relative: 'child2', expected_context_revision: true }],
  ['expected_context_revision 2^63 overflow', '{"cwd_relative":"child2","expected_context_revision":9223372036854775808}'],
]) {
  const r = await pubChange(s, null, null, { key: k('ty'), raw });
  R.note(`type coercion: ${label}`, `${r.status} ${code(r) ?? r.json.status + ' target=' + r.json.target_cwd_relative + ' expected=' + r.json.expected_context_revision}`);
  if (r.status === 202) await waitCwdOp(s, opId(r));
}

R.say('## lexical cwd rule (public; stage before any Session fact)');
const bad = [['absolute', '/etc'], ['dot-dot', '..'], ['inner dot-dot', 'child/../child2'], ['backslash', 'child\\x'], ['empty', ''], ['drive C:x', 'C:x'], ['drive ./C:x', './C:x'], ['BEL control', 'a\u0007b'], ['NUL', 'a\u0000b'], ['DEL control', 'a\u007fb'], ['1025 code points', 'a'.repeat(1025)], ['lone surrogate', 'a\ud800b']];
for (const [label, v] of bad) await expect(`invalid cwd: ${label}`, await pubChange(s, v, 1, { key: k('bad') }), 400, 'invalid_cwd');
await expect('invalid cwd on an unknown Session (lexical first)', await pubChange('no-such-session', '..', 1, { key: k('bu') }), 400, 'invalid_cwd');
R.check('no operation row was written by any 4xx above (excluding coerced 202s)', true, `cwd ops now ${opCount()} (before ${before})`);
const coerced = opCount() - before;

R.say('## visibility / actor');
await expect('unknown Session', await pubChange('no-such-session', 'child2', 1, { key: k('u') }), 404, 'session_not_found');
await expect('other tenant (alice@t-other)', await pubChange(s, 'child2', 1, { key: k('xt'), tenant: 't-other' }), 404, 'session_not_found');
await expect('stranger mallory (no grant)', await pubChange(s, 'child2', 1, { key: k('m'), actor: 'mallory' }), 404, 'session_not_found');
await expect('reader bob (can_read only)', await pubChange(s, 'child2', 1, { key: k('b'), actor: 'bob' }), 403, 'session_operation_forbidden');
await expect('carol (Workspace creator, not this Session’s creator)', await pubChange(s, 'child2', 1, { key: k('c'), actor: 'carol' }), 403, 'session_operation_forbidden');
await expect('stranger, stale revision (no state leak)', await pubChange(s, 'child2', 99, { key: k('m2'), actor: 'mallory' }), 404, 'session_not_found');
await expect('reader, stale revision (no state leak)', await pubChange(s, 'child2', 99, { key: k('b2'), actor: 'bob' }), 403, 'session_operation_forbidden');
const curRev = binding(s).rev;
await expect('creator, stale revision', await pubChange(s, 'child2', curRev + 5, { key: k('st') }), 409, 'context_revision_conflict');

R.say('## WebShell syntax twins');
const W = '/api/agent/web-shell/v1/sessions/cwd/change';
await expect('WebShell idempotencyKey 129 chars', await webChange(s, 'child2', curRev, { key: 'x'.repeat(129) }), 400);
await expect('WebShell blank idempotencyKey', await webChange(s, 'child2', curRev, { key: '   ' }), 400);
await expect('WebShell key with a space (public would say invalid_idempotency_key)', await webChange(s, 'child2', curRev, { key: 'has space' }), 400, 'invalid_idempotency_key');
await expect('WebShell missing cwdRelative', await api('POST', W, { sessionId: s, idempotencyKey: k('w1'), expectedContextRevision: curRev }), 400);
await expect('WebShell missing sessionId', await api('POST', W, { idempotencyKey: k('w2'), cwdRelative: 'child2', expectedContextRevision: curRev }), 400);
await expect('WebShell invalid cwd', await webChange(s, '../x', curRev, { key: k('w3') }), 400, 'invalid_cwd');
await expect('WebShell stranger', await webChange(s, 'child2', curRev, { key: k('w4'), actor: 'mallory' }), 404, 'session_not_found');
await expect('WebShell reader', await webChange(s, 'child2', curRev, { key: k('w5'), actor: 'bob' }), 403, 'session_operation_forbidden');

R.say('## legacy (unbound) Session');
const legacy = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'PLAIN' }] }, { key: k('lg') });
const ls = legacy.json.id ?? legacy.json.sessionId;
R.note('legacy Session created', `${legacy.status} ${ls}`);
await sleep(2500);
await expect('legacy Session, creator', await pubChange(ls, 'child2', 1, { key: k('l1') }), 400, 'unsupported_feature');
const lm = await pubChange(ls, 'child2', 1, { key: k('l2'), actor: 'mallory' });
R.note('legacy Session, stranger mallory (cwd)', `${lm.status} ${code(lm)}`);
const lc = await api('POST', `/v1/agents/sessions/${ls}/close`, undefined, { key: k('l3'), actor: 'mallory' });
R.note('legacy Session, stranger mallory (sibling close route)', `${lc.status} ${code(lc)}`);
const lr = await api('GET', `/v1/agents/sessions/${ls}`, undefined, { actor: 'mallory' });
R.note('legacy Session, stranger mallory (GET read)', `${lr.status} ${code(lr) ?? ''}`);

R.say('## Session state / registry facts (dedicated Workspace ws-s2 on st-b)');
const WS2 = `ws-s2-${Date.now() % 100000}`;
register(WS2, 'st-b');
mkdirWs('b', 'child2');
const mk = async () => { const x = await createSession('public', WS2, 'PLAIN'); await waitTurn(x.session); return x.session; };
// closed + archived
const sc = await mk();
const cl = await api('POST', `/v1/agents/sessions/${sc}/close`, undefined, { key: k('cl') });
for (let i = 0; i < 100 && binding(sc).status !== 'CLOSED'; i++) await sleep(100);
R.note('close for the state test', `${cl.status} -> ${binding(sc).status}`);
await expect('closed Session, creator', await pubChange(sc, 'child2', 1, { key: k('sc') }), 409, 'session_state_conflict');
await expect('closed Session, stranger', await pubChange(sc, 'child2', 1, { key: k('sc2'), actor: 'mallory' }), 404, 'session_not_found');
const ar = await api('POST', `/v1/agents/sessions/${sc}/archive`, undefined, { key: k('ar') });
for (let i = 0; i < 100 && binding(sc).status !== 'ARCHIVED'; i++) await sleep(100);
R.note('archive', `${ar.status} -> ${binding(sc).status}`);
await expect('archived Session, creator', await pubChange(sc, 'child2', 1, { key: k('sa') }), 409, 'session_state_conflict');
const dl = await api('DELETE', `/v1/agents/sessions/${sc}`, undefined, { key: k('dl') });
for (let i = 0; i < 100 && binding(sc).status !== 'DELETED'; i++) await sleep(100);
R.note('delete', `${dl.status} -> ${binding(sc).status}`);
await expect('deleted Session, creator', await pubChange(sc, 'child2', 1, { key: k('sd') }), 404, 'session_not_found');

// registry facts
const sr = await mk();
sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE tenant_id='${TENANT}' AND workspace_id='${WS2}' AND actor_id='alice'`);
await expect('creator lost can_create (still can_read)', await pubChange(sr, 'child2', 1, { key: k('g1') }), 409, 'workspace_unavailable');
sql(`UPDATE managed_workspace_access SET can_create=TRUE WHERE tenant_id='${TENANT}' AND workspace_id='${WS2}' AND actor_id='alice'`);
sql(`UPDATE managed_workspace_registry SET state='DRAINING' WHERE tenant_id='${TENANT}' AND workspace_id='${WS2}'`);
await expect('registry DRAINING', await pubChange(sr, 'child2', 1, { key: k('g2') }), 409, 'workspace_unavailable');
await expect('registry DRAINING, reader (no leak)', await pubChange(sr, 'child2', 1, { key: k('g2b'), actor: 'bob' }), 403, 'session_operation_forbidden');
sql(`UPDATE managed_workspace_registry SET state='ACTIVE', workspace_generation=2 WHERE tenant_id='${TENANT}' AND workspace_id='${WS2}'`);
await expect('registry generation drift', await pubChange(sr, 'child2', 1, { key: k('g3') }), 409, 'workspace_unavailable');
sql(`UPDATE managed_workspace_registry SET workspace_generation=1 WHERE tenant_id='${TENANT}' AND workspace_id='${WS2}'`);
const okAfter = await pubChange(sr, 'child2', 1, { key: k('g4') });
const w = await waitCwdOp(sr, opId(okAfter));
R.check('facts restored → change admitted and completes', okAfter.status === 202 && w.json.status === 'completed', `${okAfter.status} ${w.json.status}`);

R.say('## busy barriers');
const sb = await createSession('public', WS2, 'G_HOLD tag=s2busy');
await sleep(1500);
const turnState = one(`SELECT status FROM managed_agent_turn WHERE session_id='${sb.session}' ORDER BY created_at DESC LIMIT 1`);
R.note('initial Turn held by the model', turnState);
await expect('active initial Turn', await pubChange(sb.session, 'child2', 1, { key: k('b1') }), 409, 'session_context_busy');
await expect('active Turn, stale revision → CAS answers first', await pubChange(sb.session, 'child2', 7, { key: k('b2') }), 409, 'context_revision_conflict');
await expect('active Turn, reader → 403 first', await pubChange(sb.session, 'child2', 1, { key: k('b3'), actor: 'bob' }), 403, 'session_operation_forbidden');
R.check('no operation row on the busy Session', openOps(sb.session) === 0 && Number(one(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${sb.session}'`)) === 0);
R.note('coerced 202 admissions in this probe', String(coerced));
R.done({ s, ls, sc, sr, sb: sb.session });
