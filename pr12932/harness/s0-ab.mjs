// S0: before/after. The same real stack serves one Session with a completed
// Turn; read its Turn list and detail. usage: node s0-ab.mjs <jarTag> <engine>
import fs from 'node:fs';
import path from 'node:path';
import { SP, OUT, openLog, say, freshDb, startModel, startHarness, startSpring, api, createSession, awaitTurn } from './lib.mjs';

const TAG = process.argv[2] ?? 'base';
const ENGINE = process.argv[3] ?? 'mysql';
const DB = `s0_${TAG}_${ENGINE}`;
const BASE = { mysql: 19200, mariadb: 19300 }[ENGINE] + (TAG === 'pr' ? 0 : 50);
const P = { model: BASE + 1, harness: BASE + 2, spring: BASE + 3 };
openLog(`s0-${TAG}-${ENGINE}`);
freshDb(ENGINE, DB);
await startModel(P.model);
await startHarness(`s0-${TAG}-${ENGINE}`, P.harness, P.model);
await startSpring(`s0-${TAG}-${ENGINE}`, { jar: path.join(SP, 'jars', `${TAG}-server.jar`), engine: ENGINE, db: DB, port: P.spring, harnessPort: P.harness, storePort: P.spring });
const sid = await createSession(P.spring, { input: 'hello' });
await awaitTurn(P.spring, sid, undefined, 1, 90);
const s = await api(P.spring, 'GET', `/v1/agents/sessions/${sid}`);
const ev = await api(P.spring, 'GET', `/v1/agents/sessions/${sid}/events?limit=100`);
const turnId = ev.json.data.find((e) => e.type === 'turn.completed')?.turn_id ?? ev.json.data.find((e) => e.turn_id)?.turn_id;
const list = await api(P.spring, 'GET', `/v1/agents/sessions/${sid}/turns`);
const one = await api(P.spring, 'GET', `/v1/agents/sessions/${sid}/turns/${turnId}`);
const out = { tag: TAG, engine: ENGINE, session: sid, sessionStatus: s.json.status, activeTurn: s.json.active_turn ?? null, turnId, list: { status: list.status, body: list.json }, detail: { status: one.status, body: one.json } };
fs.writeFileSync(path.join(OUT, `s0-${TAG}-${ENGINE}.json`), JSON.stringify(out, null, 2));
say('RESULT', `GET /turns -> ${list.status} ${JSON.stringify(list.json)}`);
say('RESULT', `GET /turns/${turnId} -> ${one.status} ${JSON.stringify(one.json)}`);
process.exit(0);
