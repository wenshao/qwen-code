// VERIFICATION RIG ONLY (PR #13112 round 6): later Turns x main's archive / unarchive / delete of closed bound Sessions (#13194).
// usage: BASE=http://127.0.0.1:18137 RUNDIR=<rig>/run/lx-<db> DB=<db> node s17-retention-interplay.mjs
import { api, sql, one, register, waitTurn, turnRow, Report, sleep, TENANT, j } from './lib.mjs';
const r = new Report(`s17-retention-interplay-${process.env.DB}`);
const k = (s) => `${s}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const WS = 'ws-h';
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, 'st-h');
const caps = async (S, actor) => (await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: S }, { actor })).json.capabilities;
const capStr = (c) => c ? `turns=${c.workspaceTurns} close=${c.sessionClose} archive=${c.sessionArchive} unarchive=${c.sessionUnarchive} delete=${c.sessionDelete}` : 'none';
async function waitOp(S, id, ms = 90_000) {
  const t0 = Date.now();
  for (;;) {
    const g = await api('GET', `/v1/agents/sessions/${S}/operations/${id}`, undefined, { actor: 'alice' });
    if (['completed', 'failed', 'recovery_blocked'].includes(g.json.status) || Date.now() - t0 > ms) return `${g.json.status} ${g.json.failure_code ?? ''} ${Date.now() - t0} ms`;
    await sleep(300);
  }
}
const tryAll = async (S, tag) => {
  const turnsBefore = turnRow(S).length;
  const sub = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_FILES name=${tag}.txt tag=${tag}`), { actor: 'alice', key: k(`${tag}-s`) });
  const ws = await api('POST', '/api/agent/web-shell/v1/turns/submit', { sessionId: S, idempotencyKey: k(`${tag}-w`), input: [{ type: 'input_text', text: `PLAIN ${tag}` }] }, { actor: 'alice' });
  const rn = await api('PATCH', `/v1/agents/sessions/${S}`, { title: tag }, { actor: 'alice', key: k(`${tag}-r`) });
  await sleep(1500);
  return `submit=${sub.status} ${sub.json.error?.code ?? ''} webshell-submit=${ws.status} ${ws.json.error?.code ?? ''} rename=${rn.status} ${rn.json.error?.code ?? ''} turns ${turnsBefore}->${turnRow(S).length}`;
};

const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=h.txt tag=h0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('c') });
const S = c.json.id;
await waitTurn(S, { timeoutMs: 120_000 });
await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_FILES name=h.txt tag=h1'), { actor: 'alice', key: k('l1') });
r.note('later Turn before close', j(await waitTurn(S, { timeoutMs: 120_000 })));
r.note('capabilities ACTIVE (alice / bob)', `${capStr(await caps(S, 'alice'))} | ${capStr(await caps(S, 'bob'))}`);

// close, then race a later Turn right behind it
const cl = await api('POST', `/v1/agents/sessions/${S}/close`, {}, { actor: 'alice', key: k('close') });
const race = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_FILES name=race.txt tag=race'), { actor: 'alice', key: k('race') });
r.check('later Turn right behind an accepted close is refused', race.status === 409, `${race.status} ${race.json.error?.code ?? ''}`);
r.note('close', `${cl.status} -> ${await waitOp(S, cl.json.id)}`);
r.note('CLOSED: capabilities (alice / bob)', `${capStr(await caps(S, 'alice'))} | ${capStr(await caps(S, 'bob'))}`);
r.note('CLOSED: creator submit / rename', await tryAll(S, 'closed'));

const ar = await api('POST', `/v1/agents/sessions/${S}/archive`, {}, { actor: 'alice', key: k('archive') });
r.note('archive', `${ar.status} ${ar.json.error?.code ?? ''} -> ${ar.json.id ? await waitOp(S, ar.json.id) : ''}`);
r.note('ARCHIVED: capabilities (alice / bob)', `${capStr(await caps(S, 'alice'))} | ${capStr(await caps(S, 'bob'))}`);
const archivedTry = await tryAll(S, 'archived');
r.check('ARCHIVED: no new Turn', archivedTry.includes('submit=409') && /turns (\d+)->\1/.test(archivedTry), archivedTry);

const ua = await api('POST', '/api/agent/web-shell/v1/sessions/unarchive', { sessionId: S, idempotencyKey: k('unarchive') }, { actor: 'alice' });
r.note('unarchive (WebShell, alice): response capabilities', `${ua.status} ${capStr(ua.json.capabilities)} status=${ua.json.status ?? ''}`);
const getAfter = await caps(S, 'alice');
r.check('unarchive response capabilities == get capabilities (alice)', j(ua.json.capabilities) === j(getAfter), `${j(ua.json.capabilities)} vs ${j(getAfter)}`);
const unarchivedTry = await tryAll(S, 'unarchived');
r.check('UNARCHIVED (still closed): no new Turn', unarchivedTry.includes('submit=409') && /turns (\d+)->\1/.test(unarchivedTry), unarchivedTry);

const del = await api('DELETE', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice', key: k('delete') });
r.note('delete', `${del.status} ${del.json.error?.code ?? ''} -> ${del.json.id ? await waitOp(S, del.json.id) : ''}`);
const deletedTry = await tryAll(S, 'deleted');
r.check('DELETED: no new Turn', !deletedTry.startsWith('submit=2') && /turns (\d+)->\1/.test(deletedTry), deletedTry);
r.note('session row', j(sql(`SELECT status, deleted_at IS NOT NULL FROM managed_agent_session WHERE session_id='${S}'`)));
r.done({ S });
