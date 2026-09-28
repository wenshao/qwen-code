// Upgrade a database that an older server jar left with waiting archive and
// delete commands (made by a real Harness close outage) to the PR jar, with
// the same Hosted Harness process kept alive across the upgrade.
// usage: node upgrade.mjs <mysql|mariadb> <pre|w0e>
//   pre = main 3124af5bcc (before W0e and D4, Flyway head V15)
//   w0e = main d66fdadd27 (W0e merged, D4 not yet; Flyway head V16 = W0e)
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  SP, openLog, say, freshDb, startModel, startProxy, startHarness, startSpring, api, short, sql,
  createSession, awaitTurn, awaitOperation, writer, sessionRow, sleep, stopAll, killPid,
} from './lib.mjs';

const ENGINE = process.argv[2] ?? 'mysql';
const FROM = process.argv[3] ?? 'w0e';
const DB = `up_${FROM}_${ENGINE}`;
openLog(`upgrade-${FROM}-${ENGINE}`);
const off = (ENGINE === 'mysql' ? 0 : 100) + (FROM === 'pre' ? 0 : 50);
const P = { model: 19000 + off, harness: 19001 + off, jh: 19002 + off, jhCtl: 19003 + off, spring: 19004 + off, store: 19005 + off, storeCtl: 19006 + off };
const history = () => sql(ENGINE, DB, 'SELECT installed_rank, version, description, script, checksum, success FROM flyway_schema_history WHERE installed_rank > 0 ORDER BY installed_rank')
  .filter((r) => Number(r[1]) >= 14)
  .map((r) => `#${r[0]} V${r[1]} "${r[2]}" ${r[3]} checksum=${r[4]} ok=${r[5]}`);

freshDb(ENGINE, DB);
await startModel(P.model);
await startHarness(`h-${FROM}-${ENGINE}`, P.harness, P.model);
const jh = await startProxy(`jh-${FROM}-${ENGINE}`, P.jh, P.harness, P.jhCtl);
await startProxy(`store-${FROM}-${ENGINE}`, P.store, P.spring, P.storeCtl);
const old = await startSpring(`${FROM}-${ENGINE}`, { jar: path.join(SP, 'jars', `${FROM}-server.jar`), engine: ENGINE, db: DB, port: P.spring, harnessPort: P.jh, storePort: P.store });
const S = P.spring;
say(`${FROM} jar`, `started; Flyway history (V14+):`);
for (const h of history()) say(`${FROM} history`, h);

const arch = await createSession(S, { input: 'ARCH' });
const del = await createSession(S, { input: 'DEL' });
const done = await createSession(S, { input: 'DONE' });
await awaitTurn(S, arch);
await awaitTurn(S, del);
await awaitTurn(S, done);
const kDone = `done-${randomUUID()}`;
let r = await api(S, 'POST', `/v1/agents/sessions/${done}/archive`, { idem: kDone });
say(`${FROM} archive (Harness healthy)`, short(r));
await jh.rule('DELETE', '^/session/', '503');
const kArch = `arch-${randomUUID()}`;
const kDel = `del-${randomUUID()}`;
r = await api(S, 'POST', `/v1/agents/sessions/${arch}/archive`, { idem: kArch });
say(`${FROM} archive (Harness close 503)`, short(r));
r = await api(S, 'DELETE', `/v1/agents/sessions/${del}`, { idem: kDel });
say(`${FROM} delete (Harness close 503)`, short(r));
say(`${FROM} commands`, JSON.stringify(sql(ENGINE, DB, "SELECT operation, command_status, session_status_before FROM managed_agent_command WHERE operation IN ('ARCHIVE_SESSION','DELETE_SESSION') ORDER BY created_at")));

killPid(old.child);
await sleep(1500);
await jh.clear();
const t = Date.now();
await startSpring(`pr-from-${FROM}-${ENGINE}`, { jar: path.join(SP, 'jars', 'pr-server.jar'), engine: ENGINE, db: DB, port: P.spring, harnessPort: P.jh, storePort: P.store });
say('PR jar', `started after ${((Date.now() - t) / 1000).toFixed(1)}s; Flyway history (V14+):`);
for (const h of history()) say('PR history', h);
say('PR commands', JSON.stringify(sql(ENGINE, DB, "SELECT operation, command_status FROM managed_agent_command WHERE operation IN ('ARCHIVE_SESSION','DELETE_SESSION') ORDER BY created_at")));
const ops = sql(ENGINE, DB, 'SELECT session_id, operation_id, operation_kind, idempotency_key, actor_digest FROM managed_agent_operation ORDER BY created_at');
say('PR migrated operations', JSON.stringify(ops.map(([s, o, k, key, a]) => ({ session: s.slice(0, 8), operation: o, kind: k, key: key.slice(0, 12), actor: a || "''" }))));
for (const [sessionId, operationId, kind] of ops) {
  r = await awaitOperation(S, sessionId, operationId, undefined, 90);
  say(`PR ${kind} completed`, `${short(r)} | ${sessionRow(ENGINE, DB, sessionId)} | writer ${writer(ENGINE, DB, sessionId)}`);
}
const closes = jh.entries().filter((e) => e.method === 'DELETE' && e.action === 'pass');
say('PR Harness closes', closes.map((e) => `${e.url.slice(0, 18)}… -> ${e.status}`).join('; '));
r = await api(S, 'POST', `/v1/agents/sessions/${arch}/archive`, { idem: kArch });
say('retry migrated archive key', `${short(r)} same=${r.json.id === ops.find((o) => o[0] === arch)?.[1]}`);
r = await api(S, 'DELETE', `/v1/agents/sessions/${del}`, { idem: kDel });
say('retry migrated delete key', `${short(r)} same=${r.json.id === ops.find((o) => o[0] === del)?.[1]}`);
r = await api(S, 'POST', `/v1/agents/sessions/${done}/archive`, { idem: kDone });
say(`retry completed ${FROM} archive key`, short(r));

// A new Session on the upgraded database: close, archive and delete as D4 operations.
const fresh = await createSession(S, { input: 'FRESH' });
await awaitTurn(S, fresh);
for (const [verb, method, url] of [['close', 'POST', `/v1/agents/sessions/${fresh}/close`], ['archive', 'POST', `/v1/agents/sessions/${fresh}/archive`], ['delete', 'DELETE', `/v1/agents/sessions/${fresh}`]]) {
  r = await api(S, method, url, { idem: randomUUID() });
  const done2 = r.json?.id ? await awaitOperation(S, fresh, r.json.id, undefined, 60) : r;
  say(`new Session ${verb}`, `${short(r)} -> ${short(done2)}`);
}
say('done', `upgrade ${FROM} -> PR on ${ENGINE} complete`);
stopAll();
process.exit(0);
