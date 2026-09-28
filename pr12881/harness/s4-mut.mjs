// S4: two servers on one database, each with its own Hosted Harness.
//  a) both alive: Sessions run on one server's Harness, closed through the other.
//  b) the holding server and its Harness die (kill -9): the other server
//     completes once the dead Harness's writer lease expires.
//  c) the holding server's Java dies but its Harness lives on and keeps its
//     Store link (as behind a shared Store URL).
// usage: node s4-multiserver.mjs <engine> <n>
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  SP, openLog, say, freshDb, startModel, startProxy, startHarness, startSpring, api, short, sql,
  createSession, awaitTurn, awaitOperation, writer, opRow, sleep, stopAll, killPid, waitFor,
} from './lib.mjs';

const ENGINE = process.argv[2] ?? 'mysql';
const N = Number(process.argv[3] ?? 8);
const DB = `s4_${ENGINE}`;
openLog(`s4-mut-${process.env.JAR_TAG ?? 'pr'}-${ENGINE}`);
const JAR = path.join(SP, 'jars', `${process.env.JAR_TAG ?? 'pr'}-server.jar`);
freshDb(ENGINE, DB);
await startModel(18800);
const HA = await startHarness('ha', 18811, 18800);
const HB = await startHarness('hb', 18812, 18800);
await startProxy('ja', 18821, 18811, 18831);
await startProxy('jb', 18822, 18812, 18832);
const sa = await startProxy('store-a', 18841, 18801, 18851);
await startProxy('store-b', 18842, 18802, 18852);
let A = await startSpring('a', { jar: JAR, engine: ENGINE, db: DB, port: 18801, harnessPort: 18821, storePort: 18841 });
const B = await startSpring('b', { jar: JAR, engine: ENGINE, db: DB, port: 18802, harnessPort: 18822, storePort: 18842 });
const boots = {};
async function bootOf(port) {
  const r = await fetch(`http://127.0.0.1:${port}/capabilities`, { headers: { authorization: "Bearer rig-harness-token-12881" } });
  return JSON.stringify(await r.json()).match(/"bootId":"([^"]+)"/)[1];
}
boots[await bootOf(18811)] = "HA";
boots[await bootOf(18812)] = "HB";
const holder = (id) => boots[sql(ENGINE, DB, `SELECT harness_boot_id FROM managed_agent_session WHERE session_id='${id}'`)[0][0]] ?? '?';

async function runOn(port, n, label) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    ids.push(await createSession(port, { input: `${label}_${i}` }));
    await awaitTurn(port, ids.at(-1));
  }
  return ids;
}

// a) both alive
const ids = await runOn(18801, N, 'MULTI');
say('a holders', ids.map(holder).join(' '));
const t = {};
const ops = {};
for (const id of ids) {
  const r = await api(18802, 'POST', `/v1/agents/sessions/${id}/close`, { idem: randomUUID() });
  ops[id] = r.json.id;
  t[id] = Date.now();
}
for (const id of ids) {
  const r = await awaitOperation(18802, id, ops[id], undefined, 240);
  const row = sql(ENGINE, DB, `SELECT attempt_count, claim_generation FROM managed_agent_operation WHERE operation_id='${ops[id]}'`)[0];
  say('a closed via B', `held by ${holder(id)} | ${((Date.now() - t[id]) / 1000).toFixed(1)}s | ${r.json.admission_stage} | attempts=${row[0]} claims=${row[1]} | writer ${writer(ENGINE, DB, id).split(' ')[0]}`);
}

// b) holding server and Harness die
const [b1] = await runOn(18801, 1, 'DIE');
say('b holder', holder(b1));
killPid(A.child);
killPid(HA.child);
const tDie = Date.now();
let r = await api(18802, 'POST', `/v1/agents/sessions/${b1}/close`, { idem: randomUUID() });
r = await awaitOperation(18802, b1, r.json.id, undefined, 240);
say('b closed via B after A+HA died', `${((Date.now() - tDie) / 1000).toFixed(1)}s | ${short(r)} | ${opRow(ENGINE, DB, r.json.id)} | writer ${writer(ENGINE, DB, b1)}`);

if (process.env.SKIP_C) { stopAll(); process.exit(0); }
// c) Java A dies, its Harness lives on and reaches the Store through B
const HA2 = await startHarness('ha2', 18811, 18800);
boots[await bootOf(18811)] = "HA2";
A = await startSpring('a2', { jar: JAR, engine: ENGINE, db: DB, port: 18801, harnessPort: 18821, storePort: 18842 });
const [c1] = await runOn(18801, 1, 'ORPHAN');
say('c holder', holder(c1));
killPid(A.child);
const tJ = Date.now();
r = await api(18802, 'POST', `/v1/agents/sessions/${c1}/close`, { idem: randomUUID() });
const cOp = r.json.id;
let done = false;
try {
  r = await awaitOperation(18802, c1, cOp, undefined, 150);
  done = true;
} catch {}
say('c closed via B while HA2 lives', `${done ? 'completed' : 'NOT completed'} after ${((Date.now() - tJ) / 1000).toFixed(0)}s | ${opRow(ENGINE, DB, cOp)} | writer ${writer(ENGINE, DB, c1)}`);
if (!done) {
  const tBack = Date.now();
  A = await startSpring('a3', { jar: JAR, engine: ENGINE, db: DB, port: 18801, harnessPort: 18821, storePort: 18842 });
  r = await awaitOperation(18802, c1, cOp, undefined, 150);
  say('c after Java A restarts', `${((Date.now() - tBack) / 1000).toFixed(1)}s after restart | ${short(r)} | ${opRow(ENGINE, DB, cOp)} | writer ${writer(ENGINE, DB, c1)}`);
}
stopAll();
process.exit(0);
