// S4d: two healthy servers, each with its own Harness. Sessions are held by
// A's Harness; their closes are admitted on B (a load balancer's choice).
// Which server claims each retry, and how long does the close take?
// usage: node s4d-phase.mjs <engine> <n> <staggerSeconds> <capSeconds> [jarTag]
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SP, openLog, say, freshDb, startModel, startProxy, startHarness, startSpring, api, sql,
  createSession, awaitTurn, sleep, stopAll,
} from './lib.mjs';

const [ENGINE = 'mysql', N = '6', STAGGER = '9', CAP = '360', TAG = 'pr'] = process.argv.slice(2);
const DB = `s4d_${TAG}_${ENGINE}`;
openLog(`s4d-phase-${TAG}-${ENGINE}`);
const JAR = path.join(SP, 'jars', `${TAG}-server.jar`);
freshDb(ENGINE, DB);
await startModel(18800);
await startHarness('ha', 18811, 18800);
await startHarness('hb', 18812, 18800);
const pa = await startProxy('ja', 18821, 18811, 18831);
const pb = await startProxy('jb', 18822, 18812, 18832);
await startProxy('store-a', 18841, 18801, 18851);
await startProxy('store-b', 18842, 18802, 18852);
await startSpring('a', { jar: JAR, engine: ENGINE, db: DB, port: 18801, harnessPort: 18821, storePort: 18841 });
await startSpring('b', { jar: JAR, engine: ENGINE, db: DB, port: 18802, harnessPort: 18822, storePort: 18842 });
const ids = [];
for (let i = 0; i < Number(N); i++) {
  ids.push(await createSession(18801, { input: `PHASE_${i}` }));
  await awaitTurn(18801, ids.at(-1));
}
const res = {};
const t0 = Date.now();
await Promise.all(
  ids.map(async (id, i) => {
    await sleep(i * Number(STAGGER) * 1000);
    const r = await api(18802, 'POST', `/v1/agents/sessions/${id}/close`, { idem: randomUUID() });
    const op = r.json.id;
    const start = Date.now();
    for (;;) {
      const g = await api(18802, 'GET', `/v1/agents/sessions/${id}/operations/${op}`);
      if (g.json.status === 'completed') {
        res[id] = { op, secs: (Date.now() - start) / 1000, stage: g.json.admission_stage };
        break;
      }
      if (Date.now() - start > Number(CAP) * 1000) {
        res[id] = { op, secs: null };
        break;
      }
      await sleep(500);
    }
  }),
);
// Who attempted: a DELETE through A's proxy reaches the holding Harness,
// one through B's proxy reaches B's Harness, which never held the Session.
for (const id of ids) {
  const who = [
    ...pa.entries().filter((e) => e.method === 'DELETE' && e.url.includes(id)).map((e) => ({ t: e.t, s: 'A' })),
    ...pb.entries().filter((e) => e.method === 'DELETE' && e.url.includes(id)).map((e) => ({ t: e.t, s: 'B' })),
  ].sort((x, y) => x.t.localeCompare(y.t)).map((e) => e.s).join('');
  const row = sql(ENGINE, DB, `SELECT attempt_count, claim_generation FROM managed_agent_operation WHERE operation_id='${res[id].op}'`)[0];
  say('close', `${id.slice(0, 8)} | ${res[id].secs === null ? `NOT completed within ${CAP}s` : `${res[id].secs.toFixed(1)}s ${res[id].stage}`} | claims=${row[1]} failed attempts=${row[0]} | attempts by ${who}`);
}
stopAll();
process.exit(0);
