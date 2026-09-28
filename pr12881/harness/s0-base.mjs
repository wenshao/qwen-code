// S0: the same Harness outage on main (base jar) for a before/after.
// usage: node s0-base.mjs <jarTag> <engine>
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  SP, openLog, say, freshDb, startModel, startProxy, startHarness, startSpring, api, short,
  createSession, awaitTurn, writer, sessionRow, sleep, stopAll,
} from './lib.mjs';

const TAG = process.argv[2] ?? 'base';
const ENGINE = process.argv[3] ?? 'mysql';
const DB = `s0_${TAG}_${ENGINE}`;
openLog(`s0-${TAG}-${ENGINE}`);
const P = { model: 18800, harness: 18811, jh: 18821, jhCtl: 18831, spring: 18801, store: 18841, storeCtl: 18851 };
freshDb(ENGINE, DB);
await startModel(P.model);
await startHarness('a', P.harness, P.model);
const jh = await startProxy('jh', P.jh, P.harness, P.jhCtl);
await startProxy('store', P.store, P.spring, P.storeCtl);
await startSpring('a', { jar: path.join(SP, 'jars', `${TAG}-server.jar`), engine: ENGINE, db: DB, port: P.spring, harnessPort: P.jh, storePort: P.store });
const S = P.spring;
say('setup', `jar=${TAG} engine=${ENGINE}`);

const id = await createSession(S, { input: 'FIRST' });
await awaitTurn(S, id);
say('1 session', `${sessionRow(ENGINE, DB, id)} | writer ${writer(ENGINE, DB, id)}`);
let r = await api(S, 'POST', `/v1/agents/sessions/${id}/close`, { idem: randomUUID() });
say('2 POST /close', short(r));
await jh.rule('DELETE', '^/session/', '503');
const k = `archive-${randomUUID()}`;
r = await api(S, 'POST', `/v1/agents/sessions/${id}/archive`, { idem: k });
say('3 archive while Harness close fails', short(r));
await sleep(6000);
r = await api(S, 'GET', `/v1/agents/sessions/${id}`);
say('3 session 6 s later', `${short(r)} | ${sessionRow(ENGINE, DB, id)}`);
const cmd = (await import('./lib.mjs')).sql(ENGINE, DB, `SELECT operation, command_status FROM managed_agent_command WHERE session_id='${id}' AND operation LIKE '%SESSION'`);
say('3 command rows', JSON.stringify(cmd));
await jh.clear();
await sleep(6000);
r = await api(S, 'GET', `/v1/agents/sessions/${id}`);
say('4 Harness healthy again, 6 s later, no client retry', `${short(r)} | ${sessionRow(ENGINE, DB, id)}`);
r = await api(S, 'POST', `/v1/agents/sessions/${id}/archive`, { idem: k });
say('5 client retries the same key', `${short(r)} | writer ${writer(ENGINE, DB, id)}`);
r = await api(S, 'GET', `/v1/agents/sessions/${id}/operations/op_x`);
say('6 operation route', short(r));
say('done', 'S0 complete');
stopAll();
process.exit(0);
