// VERIFICATION RIG ONLY (PR #13112): later Turns, cancel, rename and still-gated lifecycle on a bound Session.
// usage: DB=<db> node s1-later-turns.mjs <workspace> <storage> <arm: head|main>
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, modelEntries, Report, sleep, TENANT, j } from './lib.mjs';

const [WS, ST, ARM] = [process.argv[2] ?? 'ws-a', process.argv[3] ?? 'a', process.argv[4] ?? 'head'];
const r = new Report(`s1-later-turns-${WS}-${ARM}`);
const head = ARM === 'head';
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') {
  register(WS, `st-${ST}`, { creators: ['alice', 'carol'], readers: ['bob'] });
}
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const k = (s) => `${s}-${WS}-${Date.now()}`;
const holdSeen = async (tag, ms = 40_000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (modelEntries().some((e) => e.kind === 'HOLD' && e.tag === tag)) return true;
    await sleep(150);
  }
  return false;
};
const aborted = async (tag, ms = 20_000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const e = modelEntries().find((x) => x.kind === 'HOLD-aborted' && x.tag === tag);
    if (e) return e;
    await sleep(150);
  }
  return null;
};

// 1. Initial Turn (G0 behaviour, unchanged)
const created = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=proof.txt tag=t1' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
const S = created.json.id;
r.check('alice creates a bound Session with an initial Turn -> 202', created.status === 202 || created.status === 201, `${created.status} session=${S}`);
const t1 = await waitTurn(S, { timeoutMs: 90_000 });
r.check('initial Turn COMPLETED', t1.status === 'COMPLETED', j(t1));
r.check('initial Turn wrote child/proof.txt = after-t1', readWs(ST, 'child/proof.txt') === 'after-t1', readWs(ST, 'child/proof.txt'));
const exec1 = executions(S);
r.check('initial Turn: 3 tool executions', exec1 === 3, `${exec1}`);

// 2. Per-caller capability on the WebShell surface
for (const [actor, want] of [['alice', head ? true : undefined], ['carol', head ? false : undefined], ['bob', head ? false : undefined]]) {
  const g = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: S }, { actor });
  r.check(`WebShell sessions/get as ${actor}: 200, capabilities.workspaceTurns=${want}`, g.status === 200 && g.json.capabilities?.workspaceTurns === want, `${g.status} caps=${j(g.json.capabilities)}`);
}
const gm = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: S }, { actor: 'mallory' });
r.check('WebShell sessions/get as mallory (no grant) -> 404', gm.status === 404, `${gm.status} ${gm.json.error?.code ?? ''}`);
const list = await api('POST', '/api/agent/web-shell/v1/sessions/query', {}, { actor: 'alice' });
const row = (list.json.data ?? list.json.sessions ?? []).find((s) => s.sessionId === S);
r.check('WebShell sessions/query row carries the same capability for alice', row?.capabilities?.workspaceTurns === (head ? true : undefined), j(row?.capabilities));

// 3. Later Turn: other callers refused, creator admitted
const turnsBefore = turnRow(S).length;
for (const [actor, status, code] of [['carol', 409, 'workspace_unavailable'], ['bob', 409, 'workspace_unavailable'], ['mallory', 404, null]]) {
  const x = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_FILES name=proof.txt tag=intruder'), { actor, key: k(`later-${actor}`) });
  r.check(`later Turn from ${actor} -> ${status}${code ? ' ' + code : ''}`, x.status === status && (!code || x.json.error?.code === code), `${x.status} ${x.json.error?.code ?? ''}`);
}
r.check('refused callers added no Turn', turnRow(S).length === turnsBefore, `${turnRow(S).length} vs ${turnsBefore}`);
const laterKey = k('later-alice');
const later = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_FILES name=proof.txt tag=t2'), { actor: 'alice', key: laterKey });
r.check(`creator's later Turn -> ${head ? 202 : '409 workspace_unavailable'}`, head ? later.status === 202 && !!later.json.turn_id : later.status === 409 && later.json.error?.code === 'workspace_unavailable', `${later.status} ${j(later.json).slice(0, 200)}`);
if (!head) {
  // main arm: rename and cancel are gated too; nothing more to run.
  const rn = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'renamed-main' }, { actor: 'alice', key: k('rename') });
  r.check('main: creator rename -> 409 workspace_unavailable', rn.status === 409 && rn.json.error?.code === 'workspace_unavailable', `${rn.status} ${rn.json.error?.code}`);
  r.done({ session: S });
  process.exit(r.fail ? 1 : 0);
}
const t2 = await waitTurn(S, { timeoutMs: 90_000 });
r.check('later Turn COMPLETED', t2.status === 'COMPLETED', j(t2));
r.check('later Turn rewrote child/proof.txt = after-t2 in the same bound cwd', readWs(ST, 'child/proof.txt') === 'after-t2', readWs(ST, 'child/proof.txt'));
r.check('tool executions doubled (3 -> 6)', executions(S) === 6, `${executions(S)}`);
r.check('Harness decoy cwd untouched', !readWs(ST, '../../decoy/proof.txt'), '');
const t2Req = modelEntries().filter((e) => e.tag === 't2');
r.check('later Turn: the model saw the earlier conversation (history kept)', t2Req.length === 4 && t2Req[0].userTurns >= 2, `requests=${t2Req.length} userTurns=${t2Req[0]?.userTurns} msgs=${t2Req[0]?.msgs}`);

// idempotency on the later Turn
const replay = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_FILES name=proof.txt tag=t2'), { actor: 'alice', key: laterKey });
r.check('replaying the later Turn key returns the same Turn', replay.status === 202 && replay.json.turn_id === later.json.turn_id, `${replay.status} ${replay.json.turn_id}`);
const changed = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_FILES name=proof.txt tag=other'), { actor: 'alice', key: laterKey });
r.check('same key, different body -> 409 idempotency_conflict', changed.status === 409 && changed.json.error?.code === 'idempotency_conflict', `${changed.status} ${changed.json.error?.code}`);
const carolReplay = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_FILES name=proof.txt tag=t2'), { actor: 'carol', key: laterKey });
r.check("another caller replaying the creator's key is still refused", carolReplay.status === 409 && carolReplay.json.error?.code === 'workspace_unavailable', `${carolReplay.status} ${carolReplay.json.error?.code}`);

// 4. Cancel a running later Turn (held in its model call)
const hold = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_HOLD tag=h1'), { actor: 'alice', key: k('hold') });
r.check('creator submits a Turn that the model holds -> 202', hold.status === 202, `${hold.status}`);
r.check('the held Turn reached the model', await holdSeen('h1'), '');
const busy = await api('POST', `/v1/agents/sessions/${S}/events`, msg('PLAIN second'), { actor: 'alice', key: k('busy') });
r.check('a second Turn while one runs -> 409 turn_active', busy.status === 409 && busy.json.error?.code === 'turn_active', `${busy.status} ${busy.json.error?.code}`);
const cancel = { type: 'agent.session.cancel', turn_id: hold.json.turn_id };
for (const [actor, status] of [['carol', 409], ['bob', 409], ['mallory', 404]]) {
  const x = await api('POST', `/v1/agents/sessions/${S}/events`, cancel, { actor, key: k(`cancel-${actor}`) });
  r.check(`cancel from ${actor} -> ${status}`, x.status === status, `${x.status} ${x.json.error?.code ?? ''}`);
}
const cStart = Date.now();
const c = await api('POST', `/v1/agents/sessions/${S}/events`, cancel, { actor: 'alice', key: k('cancel-alice') });
r.check('cancel from the creator -> 202', c.status === 202, `${c.status} ${j(c.json).slice(0, 160)}`);
const tc = await waitTurn(S, { timeoutMs: 40_000 });
r.check('held Turn ends CANCELLED', tc.status === 'CANCELLED', `${j(tc)} after ${Date.now() - cStart} ms`);
const ab = await aborted('h1');
r.check('the Hosted Harness aborted the model request', !!ab, ab ? `aborted after ${ab.heldMs} ms held` : 'no abort seen');
r.check('no tool ran in the cancelled Turn', executions(S) === 6, `${executions(S)}`);
r.note('Workspace execution lease rows after cancel', j(sql(`SELECT storage_key, COALESCE(holder_key,'<null>') FROM managed_workspace_execution_lease`)));
r.note('runtime sessions for this Session', j(sql(`SELECT session_state, COUNT(*) FROM qwen_runtime_session WHERE harness_session_id='${S}' GROUP BY session_state`)));

// 5. The Session keeps working after the cancel
const after = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_FILES name=proof.txt tag=t3'), { actor: 'alice', key: k('after-cancel') });
const t3 = await waitTurn(S, { timeoutMs: 90_000 });
r.check('a Turn after the cancel COMPLETES (Workspace and Runtime free)', after.status === 202 && t3.status === 'COMPLETED', `${after.status} ${j(t3)}`);
r.check('file = after-t3; executions 9', readWs(ST, 'child/proof.txt') === 'after-t3' && executions(S) === 9, `${readWs(ST, 'child/proof.txt')} ${executions(S)}`);

// 6. WebShell surface: submit and cancel as the creator; a reader stays refused
const wsub = await api('POST', '/api/agent/web-shell/v1/turns/submit', { sessionId: S, idempotencyKey: k('ws-submit'), input: [{ type: 'input_text', text: 'G_FILES name=proof.txt tag=t4' }] }, { actor: 'alice' });
const t4 = await waitTurn(S, { timeoutMs: 90_000 });
r.check('WebShell turns/submit as creator -> 202 and COMPLETED', wsub.status === 202 && t4.status === 'COMPLETED' && readWs(ST, 'child/proof.txt') === 'after-t4', `${wsub.status} ${j(t4)} ${readWs(ST, 'child/proof.txt')}`);
const wbob = await api('POST', '/api/agent/web-shell/v1/turns/submit', { sessionId: S, idempotencyKey: k('ws-bob'), input: [{ type: 'input_text', text: 'PLAIN' }] }, { actor: 'bob' });
r.check('WebShell turns/submit as bob -> 409 workspace_unavailable', wbob.status === 409 && wbob.json.error?.code === 'workspace_unavailable', `${wbob.status} ${wbob.json.error?.code}`);
const wh = await api('POST', '/api/agent/web-shell/v1/turns/submit', { sessionId: S, idempotencyKey: k('ws-hold'), input: [{ type: 'input_text', text: 'G_HOLD tag=h2' }] }, { actor: 'alice' });
await holdSeen('h2');
const wcCarol = await api('POST', '/api/agent/web-shell/v1/turns/cancel', { sessionId: S, idempotencyKey: k('ws-cancel-carol'), turnId: wh.json.turnId }, { actor: 'carol' });
r.check('WebShell turns/cancel as carol -> 409', wcCarol.status === 409, `${wcCarol.status} ${wcCarol.json.error?.code}`);
const wc = await api('POST', '/api/agent/web-shell/v1/turns/cancel', { sessionId: S, idempotencyKey: k('ws-cancel'), turnId: wh.json.turnId }, { actor: 'alice' });
const th2 = await waitTurn(S, { timeoutMs: 40_000 });
r.check('WebShell turns/cancel as creator -> 202, Turn CANCELLED, model aborted', wc.status === 202 && th2.status === 'CANCELLED' && !!(await aborted('h2')), `${wc.status} ${j(th2)}`);

// 7. Rename: creator only
for (const [actor, status] of [['carol', 409], ['bob', 409], ['mallory', 404]]) {
  const x = await api('PATCH', `/v1/agents/sessions/${S}`, { title: `by-${actor}` }, { actor, key: k(`rename-${actor}`) });
  r.check(`rename from ${actor} -> ${status}`, x.status === status, `${x.status} ${x.json.error?.code ?? ''}`);
}
const rn = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'Renamed by creator' }, { actor: 'alice', key: k('rename-alice') });
r.check('rename from the creator -> 200 with the new title', rn.status === 200 && rn.json.metadata?.title === 'Renamed by creator', `${rn.status} ${j(rn.json.metadata ?? rn.json.error)}`);
const g2 = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: S }, { actor: 'bob' });
r.check('a reader sees the new title', g2.json.title === 'Renamed by creator', g2.json.title);

// 8. Lifecycle stays gated for the creator
for (const [method, path, body, label] of [
  ...(process.env.CLOSE_OPEN ? [] : [['POST', `/v1/agents/sessions/${S}/close`, {}, 'close']]),
  ['POST', `/v1/agents/sessions/${S}/archive`, {}, 'archive'],
  ['POST', `/v1/agents/sessions/${S}/unarchive`, {}, 'unarchive'],
  ['DELETE', `/v1/agents/sessions/${S}`, undefined, 'delete'],
]) {
  const x = await api(method, path, body, { actor: 'alice', key: k(label) });
  r.check(`creator ${label} (public) -> 409 workspace_unavailable`, x.status === 409 && x.json.error?.code === 'workspace_unavailable', `${x.status} ${x.json.error?.code ?? j(x.json).slice(0, 120)}`);
}
for (const op of (process.env.CLOSE_OPEN ? ['archive', 'delete'] : ['close', 'archive', 'delete'])) {
  const x = await api('POST', `/api/agent/web-shell/v1/sessions/${op}`, { sessionId: S, idempotencyKey: k(`ws-${op}`) }, { actor: 'alice' });
  r.check(`creator ${op} (WebShell) -> 409 workspace_unavailable`, x.status === 409 && x.json.error?.code === 'workspace_unavailable', `${x.status} ${x.json.error?.code ?? j(x.json).slice(0, 120)}`);
}
r.check('Session still ACTIVE', one(`SELECT status FROM managed_agent_session WHERE session_id='${S}'`) === 'ACTIVE', '');
r.note('Turn history', j(turnRow(S)));
r.done({ session: S });
process.exit(r.fail ? 1 : 0);
