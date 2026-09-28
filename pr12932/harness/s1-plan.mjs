// S1: the PR's reviewer test plan on the real stack (Spring jar + packaged
// Hosted Harness + fake model + MySQL/MariaDB), plus edge probes.
// usage: node s1-plan.mjs <jarTag> <engine>
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SP, OUT, TENANT, openLog, say, sql, freshDb, startModel, startHarness, startSpring, api,
  createSession, awaitTurn, awaitOperation, waitFor, sleep,
} from './lib.mjs';

const TAG = process.argv[2] ?? 'pr';
const ENGINE = process.argv[3] ?? 'mysql';
const DB = `s1_${TAG}_${ENGINE}`;
const BASE = { mysql: 19000, mariadb: 19100 }[ENGINE] + (TAG === 'pr' ? 0 : 50);
const P = { model: BASE + 1, harness: BASE + 2, spring: BASE + 3 };
openLog(`s1-${TAG}-${ENGINE}`);

const captured = [];
let pass = 0;
let fail = 0;
const failures = [];
function check(label, ok, detail = '') {
  if (ok) pass++;
  else {
    fail++;
    failures.push(label);
  }
  say(ok ? 'PASS' : 'FAIL', `${label}${detail ? ' | ' + detail : ''}`);
}
const T = (sid) => `/v1/agents/sessions/${sid}/turns`;
async function get(url, opts = {}, op = url.includes('/turns/') ? 'getTurn' : 'listTurns') {
  const r = await api(P.spring, 'GET', url, opts);
  if (url.includes('/turns')) captured.push({ op, status: r.status, body: r.json, label: url.replace(/^.*\/sessions\//, '') });
  return r;
}
const code = (r) => r.json?.error?.code;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');

freshDb(ENGINE, DB);
await startModel(P.model);
await startHarness(`${TAG}-${ENGINE}`, P.harness, P.model);
await startSpring(`${TAG}-${ENGINE}`, {
  jar: path.join(SP, 'jars', `${TAG}-server.jar`), engine: ENGINE, db: DB, port: P.spring,
  harnessPort: P.harness, storePort: P.spring,
});
say('setup', `jar=${TAG} engine=${ENGINE} db=${DB} ports=${JSON.stringify(P)}`);
const S = P.spring;

// Counts finished Turns in the database, independent of the routes under test.
async function awaitDone(sessionId, count, seconds = 90) {
  await waitFor(async () => Number(sql(ENGINE, DB, `SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='${sessionId}' AND status IN ('COMPLETED','FAILED','CANCELLED')`)[0][0]) >= count, seconds, `${count} finished Turns`);
}
async function submit(sid, text) {
  const r = await api(S, 'POST', `/v1/agents/sessions/${sid}/events`, {
    idem: randomUUID(),
    body: { type: 'agent.session.input.message', input: [{ type: 'input_text', text }] },
  });
  if (r.status !== 202) throw new Error(`submit ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.turn_id;
}

// ---------- A1: one completed Turn ----------
const sid = await createSession(S, { input: 'FIRST' });
await awaitDone(sid, 1, 90);
let r = await get(T(sid));
const first = r.json.data?.[0];
check('A1 list after first Turn: one completed Turn, has_more=false, next_cursor=null',
  r.status === 200 && r.json.data.length === 1 && first.status === 'completed' && r.json.has_more === false && r.json.next_cursor === null,
  `${r.status} ${JSON.stringify(r.json)}`);
const detail = await get(`${T(sid)}/${first.id}`);
check('A1 detail equals the list entry', detail.status === 200 && JSON.stringify(detail.json) === JSON.stringify(first));
const row = sql(ENGINE, DB, `SELECT created_at, completed_at, status FROM managed_agent_turn WHERE session_id='${sid}'`)[0];
check('A1 created_at/completed_at are the stored ms in whole seconds',
  first.created_at === Math.floor(Number(row[0]) / 1000) && first.completed_at === Math.floor(Number(row[1]) / 1000),
  `api ${first.created_at}/${first.completed_at} db ${row[0]}/${row[1]} ${row[2]}`);
const items = await api(S, 'GET', `/v1/agents/sessions/${sid}/items?limit=100`);
check('A1 input_item_id names a real Item of the Session',
  items.json.data?.some((i) => i.id === first.input_item_id), `${first.input_item_id}`);

// ---------- A2: running Turn read equals Session.active_turn ----------
const slowTurn = await submit(sid, 'SLOW_4 hold this Turn');
let sess;
await waitFor(async () => {
  sess = await api(S, 'GET', `/v1/agents/sessions/${sid}`);
  return sess.json.active_turn?.status === 'running';
}, 30, 'running active_turn');
const live = await get(`${T(sid)}/${slowTurn}`);
check('A2 detail of the running Turn equals Session.active_turn',
  JSON.stringify(live.json) === JSON.stringify(sess.json.active_turn), `${JSON.stringify(live.json)}`);
const liveList = await get(`${T(sid)}?limit=1`);
check('A2 running Turn heads the list', liveList.json.data[0].id === slowTurn && liveList.json.data[0].status === 'running');
await awaitDone(sid, 2, 60);

// ---------- A3: 25 Turns ----------
const submitted = [first.id, slowTurn];
for (let i = 3; i <= 25; i++) {
  submitted.push(await submit(sid, `Q${i}`));
  await awaitDone(sid, i, 60);
}
const expected = [...submitted].reverse();
const dbOrder = sql(ENGINE, DB, `SELECT turn_id FROM managed_agent_turn WHERE session_id='${sid}' ORDER BY created_at DESC, turn_id DESC`).map((x) => x[0]);
check('A3 25 Turns stored; DB order = reverse submission order', dbOrder.length === 25 && JSON.stringify(dbOrder) === JSON.stringify(expected));

async function pageAll(sessionId, limit, opts = {}) {
  const seen = [];
  const pages = [];
  let cursor = null;
  for (let n = 0; n < 200; n++) {
    const q = new URLSearchParams();
    if (limit !== null) q.set('limit', String(limit));
    if (cursor) q.set('cursor', cursor);
    const res = await get(`${T(sessionId)}${q.size ? '?' + q : ''}`, opts);
    if (res.status !== 200) return { error: res, seen, pages };
    pages.push({ size: res.json.data.length, has_more: res.json.has_more, next: res.json.next_cursor });
    seen.push(...res.json.data.map((t) => t.id));
    if (!res.json.has_more) break;
    cursor = res.json.next_cursor;
  }
  return { seen, pages };
}
for (const limit of [1, 2, 3, 4, 5, 7, 10, 20, 24, 25, 26, 100, null]) {
  const { seen, pages, error } = await pageAll(sid, limit);
  const eff = limit ?? 20;
  const shapeOk = !error && pages.every((p, i) => (i < pages.length - 1
    ? p.size === eff && p.has_more === true && typeof p.next === 'string'
    : p.has_more === false && p.next === null && p.size <= eff && p.size > 0));
  check(`A4 limit=${limit ?? 'default(20)'}: ${pages.length} pages, every Turn once, newest first`,
    shapeOk && JSON.stringify(seen) === JSON.stringify(expected),
    `pages=${pages.map((p) => p.size).join('+')}${error ? ' error ' + error.status : ''}`);
}

// ---------- A5: keyset stability while new Turns arrive ----------
{
  const p1 = await get(`${T(sid)}?limit=4`);
  const collected = p1.json.data.map((t) => t.id);
  const added = [];
  for (let i = 26; i <= 28; i++) {
    added.push(await submit(sid, `Q${i}`));
    await awaitDone(sid, i, 60);
  }
  let cursor = p1.json.next_cursor;
  while (cursor) {
    const p = await get(`${T(sid)}?limit=4&cursor=${cursor}`);
    collected.push(...p.json.data.map((t) => t.id));
    cursor = p.json.next_cursor;
  }
  check('A5 3 Turns created mid-pagination: the walk still returns the original 25 exactly once',
    JSON.stringify(collected) === JSON.stringify(expected), `collected=${collected.length} new-in-walk=${collected.filter((x) => added.includes(x)).length}`);
  const fresh = await get(`${T(sid)}?limit=3`);
  check('A5 a new first page starts with the 3 new Turns', JSON.stringify(fresh.json.data.map((t) => t.id)) === JSON.stringify([...added].reverse()));
  expected.unshift(...[...added].reverse());
}

// ---------- B: validation ----------
const limitCases = [['0', 400, 'invalid_limit'], ['101', 400, 'invalid_limit'], ['-1', 400, 'invalid_limit'],
  ['abc', 400, 'invalid_request'], ['2147483648', 400, 'invalid_request'], ['1.5', 400, 'invalid_request'],
  ['1', 200], ['100', 200]];
for (const [v, st, c] of limitCases) {
  r = await get(`${T(sid)}?limit=${encodeURIComponent(v)}`);
  check(`B limit=${v} -> ${st}${c ? ' ' + c : ''}`, r.status === st && (!c || code(r) === c), `${r.status} ${code(r) ?? r.json.data?.length + ' Turns'}`);
}
r = await get(`${T(sid)}?limit=`);
say('INFO', `B limit= (empty) -> ${r.status} ${code(r) ?? r.json.data?.length + ' Turns'}`);
const lastOf = (n) => expected[n];
const createdMs = (id) => sql(ENGINE, DB, `SELECT created_at FROM managed_agent_turn WHERE turn_id='${id}'`)[0][0];
const cursorCases = [
  ['bad', 'not base64', 400],
  [b64(`${createdMs(lastOf(4))}:turn x`), 'space in ID', 400],
  [b64(`0${createdMs(lastOf(4))}:${lastOf(4)}`), 'leading zero', 400],
  [b64(`9999999999999999999:${lastOf(4)}`), 'createdAt beyond long', 400],
  [b64(`-1:${lastOf(4)}`), 'negative createdAt', 400],
  [b64(`${createdMs(lastOf(4))}:${'t'.repeat(65)}`), '65-char ID', 400],
  [Buffer.from(`${createdMs(lastOf(4))}:${lastOf(4)}`).toString('base64'), 'standard base64 with padding', null],
  ['A'.repeat(513), '513 chars (contract maxLength 512)', 400],
];
for (const [c, what, st] of cursorCases) {
  r = await get(`${T(sid)}?cursor=${encodeURIComponent(c)}`);
  if (st === null) say('INFO', `B cursor ${what} -> ${r.status} ${code(r) ?? 'first=' + r.json.data?.[0]?.id}`);
  else check(`B cursor ${what} -> 400 invalid_cursor`, r.status === 400 && code(r) === 'invalid_cursor', `${r.status} ${code(r)}`);
}
r = await get(`${T(sid)}?cursor=%20%20`);
check('B blank cursor reads the first page', r.status === 200 && r.json.data[0].id === expected[0]);
r = await get(`${T(sid)}?cursor=${b64(`${createdMs(lastOf(4))}:${lastOf(4)}`)}&limit=3`);
check('B hand-made cursor at Turn #5 starts at Turn #6', r.status === 200 && r.json.data[0].id === expected[5]);

const unknownSession = randomUUID();
const turnCases = [
  [`${T(sid)}/turn_${'0'.repeat(32)}`, 404, 'turn_not_found', 'unknown Turn'],
  [`${T(sid)}/${'a'.repeat(64)}`, 404, 'turn_not_found', '64-char ID'],
  [`${T(sid)}/${'a'.repeat(65)}`, 400, 'invalid_request', '65-char ID'],
  [`${T(sid)}/${encodeURIComponent('😀'.repeat(33))}`, 404, 'turn_not_found', '33 emoji (66 UTF-16 units)'],
  [`${T(sid)}/${encodeURIComponent('😀'.repeat(65))}`, 400, 'invalid_request', '65 emoji'],
  [`${T(sid)}/${expected[3]}%20`, 404, 'turn_not_found', 'real ID + trailing space'],
  [`${T(sid)}/${expected[3]}%20%20%20`, 404, 'turn_not_found', 'real ID + 3 trailing spaces'],
  [`${T(sid)}/${expected[3].toUpperCase()}`, 404, 'turn_not_found', 'real ID upper-cased'],
  [`${T(unknownSession)}`, 404, 'session_not_found', 'list, unknown Session'],
  [`${T(unknownSession)}/${expected[3]}`, 404, 'session_not_found', 'detail, unknown Session'],
  [`${T(unknownSession)}?limit=0`, 400, 'invalid_limit', 'unknown Session + limit=0 (validated first)'],
  [`${T(unknownSession)}?cursor=bad`, 400, 'invalid_cursor', 'unknown Session + bad cursor (validated first)'],
  [`${T(unknownSession)}/${'a'.repeat(65)}`, 400, 'invalid_request', 'unknown Session + 65-char ID (validated first)'],
];
for (const [url, st, c, what] of turnCases) {
  r = await get(url);
  check(`B ${what} -> ${st} ${c}`, r.status === st && code(r) === c, `${r.status} ${code(r)}`);
}
r = await get(`${T(sid)}/${expected[3]}`);
check('B exact real ID -> 200', r.status === 200 && r.json.id === expected[3]);

// Cross-tenant and other-Session reads.
for (const [url, what] of [[T(sid), 'list'], [`${T(sid)}/${expected[0]}`, 'detail']]) {
  r = await get(url, { tenant: 't-other' });
  check(`B other tenant, ${what} -> 404 session_not_found`, r.status === 404 && code(r) === 'session_not_found', `${r.status} ${code(r)}`);
  r = await get(url, { tenant: TENANT.toUpperCase() });
  check(`B tenant differing only by case, ${what} -> 404 session_not_found`, r.status === 404 && code(r) === 'session_not_found', `${r.status} ${code(r)}`);
}
const sid2 = await createSession(S, { input: 'OTHER' });
await awaitDone(sid2, 1, 60);
r = await get(`${T(sid2)}/${expected[0]}`);
check('B Turn of another Session of the same tenant -> 404 turn_not_found', r.status === 404 && code(r) === 'turn_not_found', `${r.status} ${code(r)}`);
r = await get(T(sid2));
check('B list of the other Session shows only its own Turn', r.json.data.length === 1 && !expected.includes(r.json.data[0].id));
r = await get(`${T(sid2)}?cursor=${b64(`${createdMs(expected[0])}:${expected[0]}`)}`);
say('INFO', `B cursor from Session 1 applied to Session 2 -> ${r.status} ${r.json.data?.length} Turns (positions only)`);

// ---------- C: lifecycle ----------
async function lifecycle(kind) {
  const res = await api(S, kind === 'delete' ? 'DELETE' : 'POST', `/v1/agents/sessions/${sid}${kind === 'delete' ? '' : '/' + kind}`, { idem: `${kind}-${randomUUID()}` });
  if (res.status !== 202) throw new Error(`${kind} ${res.status} ${JSON.stringify(res.json)}`);
  await awaitOperation(S, sid, res.json.id, undefined, 120);
  return res.json.id;
}
await lifecycle('close');
r = await get(T(sid));
const all = await pageAll(sid, 100);
check('C closed Session: Turns stay readable', r.status === 200 && all.seen.length === 28);
await lifecycle('archive');
const archivedSession = await api(S, 'GET', `/v1/agents/sessions/${sid}`);
r = await get(`${T(sid)}/${expected[0]}`);
check(`C archived Session (${archivedSession.json.status}): detail readable`, r.status === 200);
const delOp = await lifecycle('delete');
for (const [url, what] of [[T(sid), 'list'], [`${T(sid)}/${expected[0]}`, 'detail']]) {
  r = await get(url);
  check(`C deleted Session, ${what} -> 404 session_not_found`, r.status === 404 && code(r) === 'session_not_found', `${r.status} ${code(r)}`);
}
r = await api(S, 'GET', `/v1/agents/sessions/${sid}/operations/${delOp}`);
check('C deleted Session: its delete operation is still readable', r.status === 200 && r.json.status === 'completed');
const rowsLeft = sql(ENGINE, DB, `SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='${sid}'`)[0][0];
say('INFO', `C Turn rows still in the DB after delete: ${rowsLeft}`);

// ---------- D: Workspace-bound Session and read grants ----------
sql(ENGINE, DB, `INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${TENANT}', 'ws-a', 1, 'storage-a', 'ws-a', 'config', 'policy', 'ACTIVE')`);
sql(ENGINE, DB, `INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}', 'ws-a', CAST('actor-a' AS BINARY), TRUE, TRUE), ('${TENANT}', 'ws-a', CAST('actor-w' AS BINARY), FALSE, TRUE)`);
r = await api(S, 'POST', '/v1/agents/sessions', { actor: 'actor-a', idem: randomUUID(), body: { agent_id: 'qwen-code', input: [], workspace: { workspace_id: 'ws-a' } } });
say('INFO', `D create bound Session as actor-a -> ${r.status} ${r.json.id ?? JSON.stringify(r.json)}`);
const bound = r.json.id;
const now = Date.now();
sql(ENGINE, DB, `INSERT INTO managed_agent_turn (tenant_id, session_id, turn_id, prompt_id, input_json, payload_digest, status, created_at, updated_at, completed_at) VALUES ('${TENANT}', '${bound}', 'turn_bound', UUID(), '[]', 'd', 'COMPLETED', ${now}, ${now}, ${now})`);
for (const [actor, st, what] of [['actor-a', 200, 'reader'], ['actor-b', 404, 'no grant'], ['actor-w', 404, 'can_create but not can_read'], [undefined, null, 'no actor']]) {
  const l = await get(T(bound), { actor });
  const d = await get(`${T(bound)}/turn_bound`, { actor });
  if (st === null) say('INFO', `D bound Session, ${what}: list ${l.status} ${code(l) ?? ''} detail ${d.status} ${code(d) ?? ''}`);
  else check(`D bound Session, ${what}: list+detail -> ${st}`, l.status === st && d.status === st && (st === 200 || (code(l) === 'session_not_found' && code(d) === 'session_not_found')), `list ${l.status} ${code(l) ?? ''} detail ${d.status} ${code(d) ?? ''}`);
}

// ---------- E: ties in the real database ----------
const tie = await createSession(S, {});
const t0 = 1_800_000_000_123;
const tieIds = ['turn_TIE', 'turn_tie', 'turn_Tie', 'turn_tie2', 'turn_tiE'];
for (const id of tieIds) sql(ENGINE, DB, `INSERT INTO managed_agent_turn (tenant_id, session_id, turn_id, prompt_id, input_json, payload_digest, status, created_at, updated_at) VALUES ('${TENANT}', '${tie}', '${id}', UUID(), 'not json {', 'd', 'COMPLETED', ${t0}, ${t0})`);
sql(ENGINE, DB, `INSERT INTO managed_agent_turn (tenant_id, session_id, turn_id, prompt_id, input_json, payload_digest, status, created_at, updated_at) VALUES ('${TENANT}', '${tie}', 'turn_older', UUID(), '[]', 'd', 'FAILED', ${t0 - 1}, ${t0}), ('${TENANT}', '${tie}', 'turn_newer', UUID(), '[]', 'd', 'CANCELLED', ${t0 + 1}, ${t0})`);
const tieExpected = sql(ENGINE, DB, `SELECT turn_id FROM managed_agent_turn WHERE session_id='${tie}' ORDER BY created_at DESC, turn_id DESC`).map((x) => x[0]);
for (const limit of [1, 2, 3]) {
  const { seen } = await pageAll(tie, limit);
  check(`E 5 Turns in the same ms (IDs differing only by case), limit=${limit}: each once, DB order`,
    JSON.stringify(seen) === JSON.stringify(tieExpected), seen.join(','));
}
for (const id of tieIds) {
  r = await get(`${T(tie)}/${id}`);
  if (r.status !== 200 || r.json.id !== id) check(`E detail ${id} returns exactly ${id}`, false, `${r.status} ${r.json.id}`);
}
check('E each case variant reads back its own Turn (input "not json {" never parsed)', true);

fs.writeFileSync(path.join(OUT, `s1-${TAG}-${ENGINE}-captured.json`), JSON.stringify(captured));
say('SUMMARY', `${pass} pass, ${fail} fail${fail ? ' -> ' + failures.join(' ; ') : ''}; ${captured.length} Turn responses captured`);
process.exit(0);
