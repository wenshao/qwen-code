// S2b: N Sessions created back to back, each with a first Turn; how many
// Turns complete, per jar. usage: node s2b-load.mjs <jarTag> <engine> <n> <seconds>
import fs from 'node:fs';
import path from 'node:path';
import { SP, openLog, say, freshDb, startModel, startProxy, startHarness, startSpring, sql, createSession, sleep, stopAll } from './lib.mjs';

const [TAG = 'pr', ENGINE = 'mysql', N = '30', SECS = '120'] = process.argv.slice(2);
const DB = `s2b_${TAG}_${ENGINE}`;
openLog(`s2b-direct-${TAG}-${ENGINE}-${N}`);
const P = { model: 18800, harness: 18811, jh: 18821, jhCtl: 18831, spring: 18801, store: 18841, storeCtl: 18851 };
freshDb(ENGINE, DB);
await startModel(P.model);
await startHarness('a', P.harness, P.model);
await startProxy('jh', P.jh, P.harness, P.jhCtl);
await startProxy('store', P.store, P.spring, P.storeCtl);
const spring = await startSpring('a', { jar: path.join(SP, 'jars', `${TAG}-server.jar`), engine: ENGINE, db: DB, port: P.spring, harnessPort: P.harness, storePort: P.spring, extra: (process.env.EXTRA ?? "").split(" ").filter(Boolean) });
const t0 = Date.now();
for (let i = 0; i < Number(N); i++) await createSession(P.spring, { input: 'LOAD' });
say('created', `${N} Sessions in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const end = Date.now() + Number(SECS) * 1000;
let rows;
while (Date.now() < end) {
  rows = sql(ENGINE, DB, 'SELECT status, COUNT(*) FROM managed_agent_turn GROUP BY status');
  if (rows.length === 1 && rows[0][0] === 'COMPLETED') break;
  await sleep(2000);
}
const log = fs.readFileSync(spring.logPath, 'utf8');
say('result', `jar=${TAG} after ${((Date.now() - t0) / 1000).toFixed(0)}s turns=${JSON.stringify(rows)} lockWaitTimeouts=${(log.match(/Lock wait timeout exceeded/g) ?? []).length}`);
stopAll();
process.exit(0);
