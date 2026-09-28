// S3: a worker that is lost mid-delivery.
//  a) kill -9 the server whose worker holds the claim; a restarted server
//     takes the operation over once the lease (default 60 s) expires.
//  b) a worker that is paused (SIGSTOP) past a 5 s lease while another server
//     claims and completes; when it resumes, its completion is fenced off.
// usage: node s3-takeover.mjs <engine>
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SP, openLog, say, freshDb, startModel, startProxy, startHarness, startSpring, api, short, sql,
  createSession, awaitTurn, awaitOperation, events, writer, opRow, sessionRow, sleep, stopAll, killPid, TENANT,
} from './lib.mjs';

const ENGINE = process.argv[2] ?? 'mysql';
const DB = `s3_${ENGINE}`;
openLog(`s3-takeover-${ENGINE}`);
const JAR = path.join(SP, 'jars', 'pr-server.jar');
freshDb(ENGINE, DB);
await startModel(18800);
await startHarness('h', 18811, 18800);
const pa = await startProxy('ja', 18821, 18811, 18831);
const pb = await startProxy('jb', 18822, 18811, 18832);
await startProxy('store', 18841, 18801, 18851);
let A = await startSpring('a1', { jar: JAR, engine: ENGINE, db: DB, port: 18801, harnessPort: 18821, storePort: 18841 });

let r;
if (!process.env.SKIP_A) {
// a) kill -9 during delivery
const id = await createSession(18801, { input: 'CRASH' });
await awaitTurn(18801, id);
await pa.rule('DELETE', '^/session/', 'hang');
r = await api(18801, 'POST', `/v1/agents/sessions/${id}/close`, { idem: randomUUID() });
const op = r.json.id;
await sleep(1500);
const leaseUntil = Number(sql(ENGINE, DB, `SELECT lease_until FROM managed_agent_operation WHERE operation_id='${op}'`)[0][0]);
say('a claimed', `${opRow(ENGINE, DB, op)} lease ends in ${((leaseUntil - Date.now()) / 1000).toFixed(1)}s`);
killPid(A.child);
const tKill = Date.now();
say('a kill -9', `server a1 killed; Harness close request held by the rig: ${pa.entries().filter((e) => e.action === 'hang').length}`);
await pa.clear();
A = await startSpring('a2', { jar: JAR, engine: ENGINE, db: DB, port: 18801, harnessPort: 18821, storePort: 18841 });
say('a restarted', `after ${((Date.now() - tKill) / 1000).toFixed(1)}s | ${opRow(ENGINE, DB, op)}`);
r = await awaitOperation(18801, id, op, undefined, 150);
say('a completed', `${((Date.now() - tKill) / 1000).toFixed(1)}s after the kill (lease ended ${((leaseUntil - tKill) / 1000).toFixed(1)}s after it) | ${short(r)} | ${opRow(ENGINE, DB, op)} | writer ${writer(ENGINE, DB, id)}`);
killPid(A.child);
await sleep(500);
}
else killPid(A.child);

// b) paused worker, 5 s lease, two servers on one Harness
const lease = ['--qwen.managed-agent.dispatch.lease-duration=5s'];
await startProxy('store-b', 18842, 18802, 18852);
// Both servers give the Harness B's Store address, as a load-balanced Store URL would.
A = await startSpring('a3', { jar: JAR, engine: ENGINE, db: DB, port: 18801, harnessPort: 18821, storePort: 18842, extra: lease });
const B = await startSpring('b', { jar: JAR, engine: ENGINE, db: DB, port: 18802, harnessPort: 18822, storePort: 18842, extra: lease });
const id2 = await createSession(18801, { input: 'PAUSE' });
await awaitTurn(18801, id2);
await pa.rule('DELETE', '^/session/', 'delay:8000');
r = await api(18801, 'POST', `/v1/agents/sessions/${id2}/close`, { idem: randomUUID() });
const op2 = r.json.id;
await sleep(700);
const heldByA = pa.entries().some((e) => e.phase === 'held' && e.url.includes(id2));
say('b claimed by a3', `${opRow(ENGINE, DB, op2)} | a3's Harness close held by rig: ${heldByA}`);
process.kill(A.child.pid, 'SIGSTOP');
const tStop = Date.now();
say('b SIGSTOP a3', 'paused');
r = await awaitOperation(18802, id2, op2, undefined, 60);
say('b completed while a3 paused', `${((Date.now() - tStop) / 1000).toFixed(1)}s after pause | ${short(r)} | ${opRow(ENGINE, DB, op2)} | writer ${writer(ENGINE, DB, id2)}`);
await sleep(9000); // a3's held close reaches the Harness meanwhile
process.kill(A.child.pid, 'SIGCONT');
say('b SIGCONT a3', `resumed after ${((Date.now() - tStop) / 1000).toFixed(1)}s; rig forwarded a3's close: ${JSON.stringify(pa.entries().filter((e) => e.phase === 'forwarded').map((e) => e.status))}`);
await sleep(4000);
const logA = fs.readFileSync(A.logPath, 'utf8').split('\n').filter((l) => l.includes(op2)).map((l) => l.replace(/^.*?(WARN|INFO|ERROR)/, '$1').slice(0, 230));
say('b a3 log for the operation', logA.join('\n    ') || '<none>');
const closedEvents = (await events(18801, id2)).filter((e) => e.type === 'session.closed').length;
say('b after resume', `${opRow(ENGINE, DB, op2)} | ${sessionRow(ENGINE, DB, id2)} | session.closed events=${closedEvents}`);
stopAll();
process.exit(0);
