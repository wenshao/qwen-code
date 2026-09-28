// S5: upgrade main -> PR on a database that main left with waiting archive
// and delete commands (made by a real Harness outage), with the same Hosted
// Harness process kept alive across the upgrade.
// usage: node s5-upgrade.mjs <engine>
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  SP, openLog, say, freshDb, startModel, startProxy, startHarness, startSpring, api, short, sql,
  createSession, awaitTurn, awaitOperation, writer, opRow, sessionRow, sleep, stopAll, killPid,
} from './lib.mjs';

const ENGINE = process.argv[2] ?? 'mysql';
const DB = `s5_${ENGINE}`;
openLog(`s5-upgrade-${ENGINE}`);
const P = { model: 18800, harness: 18811, jh: 18821, jhCtl: 18831, spring: 18801, store: 18841, storeCtl: 18851 };
freshDb(ENGINE, DB);
await startModel(P.model);
await startHarness('a', P.harness, P.model);
const jh = await startProxy('jh', P.jh, P.harness, P.jhCtl);
await startProxy('store', P.store, P.spring, P.storeCtl);
const base = await startSpring('base', { jar: path.join(SP, 'jars', 'base-server.jar'), engine: ENGINE, db: DB, port: P.spring, harnessPort: P.jh, storePort: P.store });
const S = P.spring;
say('main', `Flyway head: ${sql(ENGINE, DB, 'SELECT MAX(CAST(version AS UNSIGNED)) FROM flyway_schema_history')[0][0]}`);

const arch = await createSession(S, { input: 'ARCH' });
const del = await createSession(S, { input: 'DEL' });
const done = await createSession(S, { input: 'DONE' });
await awaitTurn(S, arch);
await awaitTurn(S, del);
await awaitTurn(S, done);
// A completed archive (not converted) and two that wait for a retry.
const kDone = `done-${randomUUID()}`;
let r = await api(S, 'POST', `/v1/agents/sessions/${done}/archive`, { idem: kDone });
say('main archive (Harness healthy)', short(r));
await jh.rule('DELETE', '^/session/', '503');
const kArch = `arch-${randomUUID()}`;
const kDel = `del-${randomUUID()}`;
r = await api(S, 'POST', `/v1/agents/sessions/${arch}/archive`, { idem: kArch });
say('main archive (Harness close fails)', short(r));
r = await api(S, 'DELETE', `/v1/agents/sessions/${del}`, { idem: kDel });
say('main delete (Harness close fails)', short(r));
for (const [n, id] of [['arch', arch], ['del', del], ['done', done]])
  say(`main state ${n}`, `${sessionRow(ENGINE, DB, id)} | writer ${writer(ENGINE, DB, id)}`);
say('main commands', JSON.stringify(sql(ENGINE, DB, "SELECT operation, command_status, session_status_before FROM managed_agent_command WHERE operation IN ('ARCHIVE_SESSION','DELETE_SESSION') ORDER BY created_at")));

// Upgrade: stop main, keep the Harness, start the PR jar.
killPid(base.child);
await sleep(1000);
await jh.clear();
const t = Date.now();
await startSpring('pr', { jar: path.join(SP, 'jars', 'pr-server.jar'), engine: ENGINE, db: DB, port: P.spring, harnessPort: P.jh, storePort: P.store });
say('PR started', `after ${((Date.now() - t) / 1000).toFixed(1)}s; Flyway: ${JSON.stringify(sql(ENGINE, DB, "SELECT version, description, success FROM flyway_schema_history WHERE version='16'"))}`);
say('PR commands', JSON.stringify(sql(ENGINE, DB, "SELECT operation, command_status FROM managed_agent_command WHERE operation IN ('ARCHIVE_SESSION','DELETE_SESSION') ORDER BY created_at")));
const ops = sql(ENGINE, DB, 'SELECT session_id, operation_id, operation_kind, idempotency_key, actor_digest FROM managed_agent_operation ORDER BY created_at');
say('PR migrated operations', JSON.stringify(ops.map(([s, o, k, key, a]) => ({ session: s.slice(0, 8), operation: o, len: o.length, kind: k, key: key.slice(0, 12), actor: a || "''" }))));
for (const [sessionId, operationId, kind] of ops) {
  r = await awaitOperation(S, sessionId, operationId, undefined, 90);
  say(`PR ${kind} completed`, `${short(r)} | ${sessionRow(ENGINE, DB, sessionId)} | writer ${writer(ENGINE, DB, sessionId)}`);
}
const ledger = jh.entries().filter((e) => e.method === 'DELETE' && e.action === 'pass');
say('PR Harness closes', ledger.map((e) => `${e.url.slice(0, 18)}… -> ${e.status}`).join('; '));
r = await api(S, 'POST', `/v1/agents/sessions/${arch}/archive`, { idem: kArch });
say('retry migrated archive key (no actor)', `${short(r)} same=${r.json.id === ops.find((o) => o[0] === arch)?.[1]}`);
r = await api(S, 'POST', `/v1/agents/sessions/${arch}/archive`, { idem: kArch, actor: 'alice' });
say('retry migrated archive key (actor alice)', short(r));
r = await api(S, 'DELETE', `/v1/agents/sessions/${del}`, { idem: kDel });
say('retry migrated delete key (no actor)', `${short(r)} same=${r.json.id === ops.find((o) => o[0] === del)?.[1]}`);
r = await api(S, 'POST', `/v1/agents/sessions/${done}/archive`, { idem: kDone });
say('retry completed main archive key', short(r));
r = await api(S, 'POST', `/v1/agents/sessions/${arch}/unarchive`, { idem: randomUUID() });
say('unarchive migrated archive', short(r));
say('done', 'S5 complete');
stopAll();
process.exit(0);
