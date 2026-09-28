// S1: the PR's reviewer test plan, end to end on the real stack, plus edge
// probes. usage: node s1-plan.mjs <jarTag> <engine>
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  SP, openLog, say, freshDb, startModel, startProxy, startHarness, startSpring, api, short,
  createSession, events, awaitTurn, awaitOperation, writer, opRow, sessionRow, sleep, stopAll,
} from './lib.mjs';

const TAG = process.argv[2] ?? 'pr';
const ENGINE = process.argv[3] ?? 'mysql';
const DB = `s1_${TAG}_${ENGINE}`;
openLog(`s1-${TAG}-${ENGINE}`);
const P = { model: 18800, harness: 18811, jh: 18821, jhCtl: 18831, spring: 18801, store: 18841, storeCtl: 18851 };

freshDb(ENGINE, DB);
await startModel(P.model);
await startHarness('a', P.harness, P.model);
const jh = await startProxy('jh', P.jh, P.harness, P.jhCtl);
await startProxy('store', P.store, P.spring, P.storeCtl);
await startSpring('a', { jar: path.join(SP, 'jars', `${TAG}-server.jar`), engine: ENGINE, db: DB, port: P.spring, harnessPort: P.jh, storePort: P.store });
say('setup', `jar=${TAG} engine=${ENGINE} db=${DB}`);
const S = P.spring;
const op = (id, o) => `/v1/agents/sessions/${id}/operations/${o}`;

// 1. Session with a completed Turn.
const id = await createSession(S, { input: 'FIRST' });
await awaitTurn(S, id);
let r = await api(S, 'GET', `/v1/agents/sessions/${id}`);
say('1 session', `${id} status=${r.json.status} capabilities=${JSON.stringify(r.json.capabilities)} | writer ${writer(ENGINE, DB, id)} | ${sessionRow(ENGINE, DB, id)}`);

// 2. Every Hosted Harness close fails.
await jh.rule('DELETE', '^/session/', '503');
const kClose = `close-${randomUUID()}`;
r = await api(S, 'POST', `/v1/agents/sessions/${id}/close`, { idem: kClose });
say('2 close (harness close failing)', short(r));
const closeOp = r.json.id;
await sleep(6000);
r = await api(S, 'GET', `/v1/agents/sessions/${id}`);
say('2 session during outage', `status=${r.json.status}`);
r = await api(S, 'POST', `/v1/agents/sessions/${id}/events`, { idem: randomUUID(), body: { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'AFTER_CLOSE' }] } });
say('2 input during outage', short(r));
r = await api(S, 'GET', op(id, closeOp));
say('2 operation during outage', `${short(r)} | db ${opRow(ENGINE, DB, closeOp)} | writer ${writer(ENGINE, DB, id)}`);
const failed = jh.entries().filter((e) => e.method === 'DELETE' && e.action === '503').length;
say('2 ledger', `${failed} DELETE /session/${id.slice(0, 8)}… answered 503 by the rig`);

// 3. Closes succeed again.
await jh.clear();
const tClear = Date.now();
r = await awaitOperation(S, id, closeOp, undefined, 120);
say('3 operation after outage', `${short(r)} after ${((Date.now() - tClear) / 1000).toFixed(1)}s | db ${opRow(ENGINE, DB, closeOp)}`);
say('3 writer/session', `writer ${writer(ENGINE, DB, id)} | ${sessionRow(ENGINE, DB, id)}`);
const passed = jh.entries().filter((e) => e.method === 'DELETE' && e.action === 'pass');
say('3 ledger', passed.map((e) => `${e.method} ${e.url.replace(id, '<id>')} -> ${e.status}`).join('; '));
r = await api(S, 'GET', `/v1/agents/sessions/${id}`);
say('3 session', `status=${r.json.status}`);

// 4. Replays and conflicts.
r = await api(S, 'POST', `/v1/agents/sessions/${id}/close`, { idem: kClose });
say('4 close same key', `${short(r)} sameOperation=${r.json.id === closeOp}`);
r = await api(S, 'POST', `/v1/agents/sessions/${id}/close`, { idem: `close-${randomUUID()}` });
say('4 close new key', short(r));

// 5. Archive / unarchive.
const other = await createSession(S, { input: 'OTHER' });
await awaitTurn(S, other);
r = await api(S, 'POST', `/v1/agents/sessions/${other}/archive`, { idem: randomUUID() });
say('5 archive active Session', short(r));
const kArchive = `archive-${randomUUID()}`;
r = await api(S, 'POST', `/v1/agents/sessions/${id}/archive`, { idem: kArchive });
say('5 archive closed Session', short(r));
const archiveOp = r.json.id;
r = await api(S, 'POST', `/v1/agents/sessions/${id}/unarchive`, { idem: randomUUID() });
say('5 unarchive', short(r));

// 6. Delete and tombstone.
const kDelete = `delete-${randomUUID()}`;
r = await api(S, 'DELETE', `/v1/agents/sessions/${id}`, { idem: kDelete });
say('6 delete', short(r));
const deleteOp = r.json.id;
r = await awaitOperation(S, id, deleteOp);
say('6 delete completed', `${short(r)} | ${sessionRow(ENGINE, DB, id)}`);
r = await api(S, 'GET', `/v1/agents/sessions/${id}`);
say('6 GET Session', short(r));
for (const [name, o] of [['close', closeOp], ['archive', archiveOp], ['delete', deleteOp]]) {
  r = await api(S, 'GET', op(id, o));
  say(`6 GET ${name} operation`, short(r));
}
r = await api(S, 'DELETE', `/v1/agents/sessions/${id}`, { idem: `delete-${randomUUID()}` });
say('6 delete new key', short(r));
r = await api(S, 'DELETE', `/v1/agents/sessions/${id}`, { idem: kDelete });
say('6 delete same key', `${short(r)} sameOperation=${r.json.id === deleteOp}`);
r = await api(S, 'GET', op(id, 'x'.repeat(65)));
say('6 overlong operation id', short(r));
r = await api(S, 'GET', op(id, 'op_doesnotexist'));
say('6 unknown operation id', short(r));

// 7. Active Turn blocks close and delete.
const slow = await createSession(S, { input: 'SLOW_12' });
await sleep(2500);
r = await api(S, 'POST', `/v1/agents/sessions/${slow}/close`, { idem: randomUUID() });
say('7 close with active Turn', short(r));
r = await api(S, 'DELETE', `/v1/agents/sessions/${slow}`, { idem: randomUUID() });
say('7 delete with active Turn', short(r));
await awaitTurn(S, slow, undefined, 1, 60);

// 8. Delete an active Session (Turn finished): the worker closes the Harness first.
r = await api(S, 'DELETE', `/v1/agents/sessions/${slow}`, { idem: randomUUID() });
say('8 delete active Session', short(r));
r = await awaitOperation(S, slow, r.json.id);
say('8 delete completed', `${short(r)} | writer ${writer(ENGINE, DB, slow)}`);

// 9. Close a Session that never ran a Turn (no Harness ever held it).
const idle = await createSession(S, {});
r = await api(S, 'POST', `/v1/agents/sessions/${idle}/close`, { idem: randomUUID() });
r = await awaitOperation(S, idle, r.json.id);
say('9 close never-run Session', `${short(r)} | writer ${writer(ENGINE, DB, idle)}`);

// 10. WebShell surface.
const W = '/api/agent/web-shell/v1';
const ws = await createSession(S, { input: 'WEBSHELL' });
await awaitTurn(S, ws);
const kWs = `ws-${randomUUID()}`;
r = await api(S, 'POST', `${W}/sessions/close`, { body: { sessionId: ws, idempotencyKey: kWs } });
say('10 webshell close', `${r.status} ${JSON.stringify(r.json)}`);
const wsOp = r.json.operationId;
for (let i = 0; i < 100; i++) {
  r = await api(S, 'POST', `${W}/operations/query`, { body: { sessionId: ws, operationId: wsOp } });
  if (r.json.status === 'completed') break;
  await sleep(200);
}
say('10 webshell operations/query', `${r.status} ${JSON.stringify(r.json)}`);
r = await api(S, 'POST', `${W}/sessions/close`, { body: { sessionId: ws, idempotencyKey: kWs } });
say('10 webshell close replay', `${r.status} replayed=${r.json.replayed} same=${r.json.operationId === wsOp}`);
r = await api(S, 'POST', `${W}/sessions/archive`, { body: { sessionId: ws, idempotencyKey: randomUUID() } });
say('10 webshell archive', `${r.status} ${JSON.stringify(r.json)}`);
r = await api(S, 'POST', `${W}/sessions/delete`, { body: { sessionId: ws, idempotencyKey: randomUUID() } });
say('10 webshell delete', `${r.status} status=${r.json.status}`);
const wsDel = r.json.operationId;
for (let i = 0; i < 100; i++) {
  r = await api(S, 'POST', `${W}/operations/query`, { body: { sessionId: ws, operationId: wsDel } });
  if (r.json.status === 'completed') break;
  await sleep(200);
}
say('10 webshell delete completed', `${r.status} ${JSON.stringify(r.json)}`);
r = await api(S, 'POST', `${W}/sessions/get`, { body: { sessionId: ws } });
say('10 webshell sessions/get after delete', short(r));

// 11. Events carry the operation id (read on a second Session before delete).
const ev = await createSession(S, { input: 'EVENTS' });
await awaitTurn(S, ev);
r = await api(S, 'POST', `/v1/agents/sessions/${ev}/close`, { idem: randomUUID() });
const evOp = r.json.id;
await awaitOperation(S, ev, evOp);
const lifecycle = (await events(S, ev)).filter((e) => e.type.startsWith('session.'));
say('11 lifecycle events', lifecycle.map((e) => `${e.type}${JSON.stringify(e.data ?? e.payload ?? {}).includes(evOp) ? '(operationId)' : ''}`).join(', '));

say('done', 'S1 complete');
stopAll();
process.exit(0);
