// Which databases a jar refuses to start on.
// usage: node refuse.mjs <mysql|mariadb>
//  A. main 42d7a2b833 (both V16) on an empty database
//  B. main d66fdadd27 (W0e only) -> main 42d7a2b833 -> PR jar on one database
//  C. #12881 head a32bd7976b (D4 as V16) -> PR jar on one database
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SP, RUN, JAVA, DBS, TOKEN, DIGEST, openLog, say, freshDb, sql, sleep, stopAll } from './lib.mjs';

const ENGINE = process.argv[2] ?? 'mysql';
openLog(`refuse-${ENGINE}`);
const PORT = ENGINE === 'mysql' ? 19404 : 19504;

// Starts a jar without a Harness and reports whether it answered or exited.
async function tryStart(label, jarName, db) {
  const d = DBS[ENGINE];
  const jdbc = `jdbc:mysql://127.0.0.1:${d.port}/${db}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false`;
  const logPath = path.join(RUN, `refuse-${ENGINE}-${label}.log`);
  const out = fs.openSync(logPath, 'w');
  const child = spawn(JAVA, ['-Duser.timezone=UTC', '-jar', path.join(SP, 'jars', jarName),
    '--server.address=127.0.0.1', `--server.port=${PORT}`,
    `--spring.datasource.url=${jdbc}`, '--spring.datasource.username=root', `--spring.datasource.password=${d.password}`,
    '--spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver',
    '--qwen.managed-agent.harness.enabled=false', '--qwen.managed-agent.runtime-broker.enabled=false'], { stdio: ['ignore', out, out] });
  let exit = null;
  child.on('exit', (c) => (exit = c));
  const end = Date.now() + 120_000;
  for (;;) {
    if (exit !== null) break;
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/v1/agents/sessions?limit=1`, { headers: { 'X-Qwen-Tenant-Id': 't-rig' } });
      if (r.status === 200) break;
    } catch {}
    if (Date.now() > end) break;
    await sleep(300);
  }
  const log = fs.readFileSync(logPath, 'utf8');
  const flyway = [...new Set(log.split('\n').filter((l) => /FlywayException|FlywayValidateException|Validate failed|Migration (checksum|description|type) mismatch|Detected (resolved|applied) migration|Found more than one migration|-> .*db\/migration/.test(l))
    .map((l) => l.replace(/^.*?(org\.flywaydb\S+: |Caused by: )/, '').replace(/\/private\/tmp\/\S*\/(BOOT-INF|db\/)/g, '…/$1').trim()))].slice(0, 8);
  if (exit === null) {
    say(label, `STARTED (HTTP 200) with ${jarName}`);
    child.kill('SIGKILL');
    await sleep(1500);
  } else {
    say(label, `REFUSED: ${jarName} exited ${exit}`);
    for (const l of flyway) say(`${label} log`, l.slice(0, 220));
  }
  return exit === null;
}
const history = (db) => {
  const t = sql(ENGINE, db, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${db}' AND table_name='flyway_schema_history'`)[0][0];
  if (t === '0') return ['<no flyway_schema_history table>'];
  return sql(ENGINE, db, 'SELECT installed_rank, version, description, checksum, success FROM flyway_schema_history ORDER BY installed_rank')
    .filter((r) => Number(r[1]) >= 14 || r[1] === 'NULL')
    .map((r) => `#${r[0]} V${r[1]} "${r[2]}" checksum=${r[3]} ok=${r[4]}`);
};
const tables = (db) => sql(ENGINE, db, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${db}'`)[0][0];

// A
let db = `refuse_a_${ENGINE}`;
freshDb(ENGINE, db);
await tryStart('A main(both V16) on empty DB', 'base-server.jar', db);
say('A tables after', `${tables(db)} tables; history: ${history(db).join(' | ')}`);

// B
db = `refuse_b_${ENGINE}`;
freshDb(ENGINE, db);
await tryStart('B1 main(W0e only) on empty DB', 'w0e-server.jar', db);
for (const h of history(db)) say('B1 history', h);
const before = JSON.stringify(history(db));
await tryStart('B2 main(both V16) on that DB', 'base-server.jar', db);
say('B2 history unchanged', String(JSON.stringify(history(db)) === before));
await tryStart('B3 PR jar on that DB', 'pr-server.jar', db);
for (const h of history(db)) say('B3 history', h);

// C
db = `refuse_c_${ENGINE}`;
freshDb(ENGINE, db);
await tryStart('C1 #12881 head (D4 as V16) on empty DB', 'd4-server.jar', db);
for (const h of history(db)) say('C1 history', h);
await tryStart('C2 PR jar on that DB', 'pr-server.jar', db);
for (const h of history(db)) say('C2 history', h);
say('done', `refuse ${ENGINE} complete`);
stopAll();
process.exit(0);
