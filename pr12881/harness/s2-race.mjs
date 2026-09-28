// S2: concurrent lifecycle requests against one Session on a real database.
// usage: node s2-race.mjs <engine> <n>
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  SP, openLog, say, freshDb, startModel, startProxy, startHarness, startSpring, api, sql,
  createSession, awaitTurn, awaitOperation, stopAll, sleep,
} from './lib.mjs';

const ENGINE = process.argv[2] ?? 'mysql';
const N = Number(process.argv[3] ?? 30);
const DB = `s2_${ENGINE}`;
openLog(`s2-race-${ENGINE}`);
const P = { model: 18800, harness: 18811, jh: 18821, jhCtl: 18831, spring: 18801, store: 18841, storeCtl: 18851 };
freshDb(ENGINE, DB);
await startModel(P.model);
await startHarness('a', P.harness, P.model);
await startProxy('jh', P.jh, P.harness, P.jhCtl);
await startProxy('store', P.store, P.spring, P.storeCtl);
await startSpring('a', { jar: path.join(SP, 'jars', 'pr-server.jar'), engine: ENGINE, db: DB, port: P.spring, harnessPort: P.jh, storePort: P.store });
const S = P.spring;
const input = (id) => api(S, 'POST', `/v1/agents/sessions/${id}/events`, { idem: randomUUID(), body: { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'RACE' }] } });
const close = (id, idem = randomUUID(), actor) => api(S, 'POST', `/v1/agents/sessions/${id}/close`, { idem, actor });
const del = (id, idem = randomUUID()) => api(S, 'DELETE', `/v1/agents/sessions/${id}`, { idem });
const rename = (id) => api(S, 'PATCH', `/v1/agents/sessions/${id}`, { idem: randomUUID(), body: { title: 'renamed' } });
const code = (r) => `${r.status}${r.json?.error ? ':' + r.json.error.code : r.json?.replayed ? ':replay' : ''}`;

async function ready(n) {
  const ids = [];
  // One at a time: a burst of first Turns stalls on main too (see s2b-load).
  for (let i = 0; i < n; i++) {
    ids.push(await createSession(S, { input: "SETUP" }));
    await awaitTurn(S, ids.at(-1), undefined, 1, 120);
  }
  return ids;
}

const tally = {};
const bump = (k) => (tally[k] = (tally[k] ?? 0) + 1);
const violations = [];

// A. close vs input
let ids = await ready(N);
for (const id of ids) {
  const [c, i] = await Promise.all([close(id), input(id)]);
  bump(`A close=${code(c)} input=${code(i)}`);
  if (c.status === 202 && i.status === 202) violations.push(`A both admitted ${id}`);
  if (c.status === 202) {
    await awaitOperation(S, id, c.json.id, undefined, 120);
    const turns = sql(ENGINE, DB, `SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='${id}' AND status IN ('ACCEPTED','RUNNING','CANCELLING')`)[0][0];
    if (turns !== '0') violations.push(`A closed with open Turn ${id} (${turns})`);
  }
}
// A2. input sent first, close after 0-15 ms
ids = await ready(N);
for (const id of ids) {
  const ip = input(id);
  await sleep(Math.floor(Math.random() * 16));
  const [i, c] = await Promise.all([ip, close(id)]);
  bump(`A2 input=${code(i)} close=${code(c)}`);
  if (c.status === 202 && i.status === 202) violations.push(`A2 both admitted ${id}`);
  if (c.status === 202) await awaitOperation(S, id, c.json.id, undefined, 120);
}
// B. three closes with one key
ids = await ready(N);
for (const id of ids) {
  const k = randomUUID();
  const rs = await Promise.all([close(id, k), close(id, k), close(id, k)]);
  bump(`B ${rs.map(code).sort().join(' ')}`);
  const opIds = new Set(rs.filter((r) => r.status === 202).map((r) => r.json.id));
  if (opIds.size !== 1) violations.push(`B ${opIds.size} operations for one key ${id}`);
}
// C. close vs delete vs rename, distinct keys
ids = await ready(N);
for (const id of ids) {
  const [c, d, n] = await Promise.all([close(id), del(id), rename(id)]);
  bump(`C close=${code(c)} delete=${code(d)} rename=${code(n)}`);
  const open = sql(ENGINE, DB, `SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${id}'`)[0][0];
  if (Number(open) > 1) violations.push(`C ${open} operations admitted ${id}`);
}
// D. same key from two actors (Session created without an actor is readable by both)
ids = await ready(Math.min(N, 10));
for (const id of ids) {
  const k = randomUUID();
  const [a, b] = await Promise.all([close(id, k, 'alice'), close(id, k, 'bob')]);
  bump(`D alice=${code(a)} bob=${code(b)}`);
  if (a.status === 202 && b.status === 202 && a.json.id === b.json.id) violations.push(`D cross-actor replay ${id}`);
}
await sleep(3000);
const stuck = sql(ENGINE, DB, "SELECT COUNT(*) FROM managed_agent_operation WHERE state <> 'COMPLETED'")[0][0];
for (const [k, v] of Object.entries(tally).sort()) say('tally', `${String(v).padStart(3)} × ${k}`);
say('operations not completed after 3 s', stuck);
say('500 responses', String(Object.keys(tally).filter((k) => /=500|\b500/.test(k)).length));
say('violations', violations.length ? violations.join('\n') : 'none');
stopAll();
process.exit(0);
