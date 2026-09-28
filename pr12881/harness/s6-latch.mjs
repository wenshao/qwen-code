// S6: the documented stuck close. A Store outage of a few seconds that
// overlaps one close attempt: does the close ever complete, and what does it
// take? usage: node s6-latch.mjs <engine> <observeSeconds>
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  SP, openLog, say, freshDb, startModel, startProxy, startHarness, startSpring, api, short,
  createSession, awaitTurn, awaitOperation, writer, opRow, sessionRow, sleep, stopAll, killPid,
} from './lib.mjs';

const ENGINE = process.argv[2] ?? 'mysql';
const OBSERVE = Number(process.argv[3] ?? 180);
const DB = `s6_${ENGINE}`;
openLog(`s6-latch-${ENGINE}`);
const JAR = path.join(SP, 'jars', 'pr-server.jar');
freshDb(ENGINE, DB);
await startModel(18800);
let H = await startHarness('h', 18811, 18800);
const jh = await startProxy('jh', 18821, 18811, 18831);
const store = await startProxy('store', 18841, 18801, 18851);
let J = await startSpring('j1', { jar: JAR, engine: ENGINE, db: DB, port: 18801, harnessPort: 18821, storePort: 18841 });

// Control: an idle Session; the Store is down for 5 s while nobody closes.
const ctl = await createSession(18801, { input: 'CONTROL' });
await awaitTurn(18801, ctl);
await store.rule('POST', 'transactions:commit', '503');
await sleep(5000);
await store.clear();
let r = await api(18801, 'POST', `/v1/agents/sessions/${ctl}/close`, { idem: randomUUID() });
r = await awaitOperation(18801, ctl, r.json.id, undefined, 30);
say('control: outage while idle, close afterwards', short(r));

// The outage overlaps the first close attempt.
const id = await createSession(18801, { input: 'LATCH' });
await awaitTurn(18801, id);
await store.rule('POST', 'transactions:commit', '503');
r = await api(18801, 'POST', `/v1/agents/sessions/${id}/close`, { idem: randomUUID() });
const op = r.json.id;
await sleep(5000);
await store.clear();
const tUp = Date.now();
say('outage over', `Store healthy again | ${opRow(ENGINE, DB, op)}`);
let completed = false;
while (Date.now() - tUp < OBSERVE * 1000) {
  await sleep(15000);
  r = await api(18801, 'GET', `/v1/agents/sessions/${id}/operations/${op}`);
  const closes = jh.entries().filter((e) => e.method === 'DELETE' && e.url.includes(id));
  const commits = store.entries().filter((e) => e.url?.includes(id) && e.url.includes('transactions:commit'));
  const renews = store.entries().filter((e) => e.url?.includes(id) && e.url.includes('writers:renew') && Date.parse(e.t) > Date.now() - 15000);
  say(`+${((Date.now() - tUp) / 1000).toFixed(0)}s`, `${short(r)} | ${opRow(ENGINE, DB, op)} | Harness closes: ${closes.map((e) => e.status ?? e.action).join(',')} | commits after outage: ${commits.filter((e) => Date.parse(e.t) > tUp).length} | renews in last 15 s: ${renews.length} | writer ${writer(ENGINE, DB, id)}`);
  if (r.json.status === 'completed') {
    completed = true;
    break;
  }
}
if (!completed) {
  // What the PR says it takes: restart the Harness, then Java.
  killPid(H.child);
  H = await startHarness('h2', 18811, 18800);
  const tH = Date.now();
  await sleep(10000);
  say('Harness restarted', `${opRow(ENGINE, DB, op)} | last closes: ${jh.entries().filter((e) => e.method === 'DELETE').slice(-3).map((e) => e.status ?? e.action).join(',')}`);
  killPid(J.child);
  J = await startSpring('j2', { jar: JAR, engine: ENGINE, db: DB, port: 18801, harnessPort: 18821, storePort: 18841 });
  say('Java restarted', `${opRow(ENGINE, DB, op)} | writer ${writer(ENGINE, DB, id)}`);
  r = await awaitOperation(18801, id, op, undefined, 180);
  say('completed', `${((Date.now() - tH) / 1000).toFixed(0)}s after the Harness restart | ${short(r)} | ${sessionRow(ENGINE, DB, id)} | writer ${writer(ENGINE, DB, id)}`);
}
stopAll();
process.exit(0);
