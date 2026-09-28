// Recovery for a database that a D4 branch build migrated with D4 as V16.
// usage: node repair.mjs <mysql|mariadb>   (runs on refuse_c_<engine> left by refuse.mjs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SP, RUN, JAVA, DBS, openLog, say, sql, sleep, stopAll } from './lib.mjs';
const ENGINE = process.argv[2] ?? 'mysql';
const DB = `refuse_c_${ENGINE}`;
openLog(`repair-${ENGINE}`);
const PORT = ENGINE === 'mysql' ? 19604 : 19704;
async function tryStart(label, extra = []) {
  const d = DBS[ENGINE];
  const logPath = path.join(RUN, `repair-${ENGINE}-${label}.log`);
  const out = fs.openSync(logPath, 'w');
  const child = spawn(JAVA, ['-Duser.timezone=UTC', '-jar', path.join(SP, 'jars', 'pr-server.jar'), '--server.address=127.0.0.1', `--server.port=${PORT}`,
    `--spring.datasource.url=jdbc:mysql://127.0.0.1:${d.port}/${DB}?allowPublicKeyRetrieval=true&useSSL=false`, '--spring.datasource.username=root', `--spring.datasource.password=${d.password}`,
    '--qwen.managed-agent.harness.enabled=false', '--qwen.managed-agent.runtime-broker.enabled=false', ...extra], { stdio: ['ignore', out, out] });
  let exit = null; child.on('exit', (c) => (exit = c));
  for (const end = Date.now() + 120_000; exit === null && Date.now() < end; await sleep(300)) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/v1/agents/sessions?limit=1`, { headers: { 'X-Qwen-Tenant-Id': 't' } })).status === 200) break; } catch {}
  }
  const log = fs.readFileSync(logPath, 'utf8').split('\n');
  const i = log.findIndex((l) => /Validate failed|FlywayException/.test(l));
  if (exit === null) { say(label, 'STARTED (HTTP 200)'); child.kill('SIGKILL'); await sleep(1500); }
  else say(label, `REFUSED exit ${exit}: ${log.slice(i, i + 3).map((l) => l.replace(/^.*?(FlywayValidateException|FlywayException): /, '')).join(' / ').slice(0, 260)}`);
}
const hist = () => sql(ENGINE, DB, 'SELECT installed_rank, version, description, checksum FROM flyway_schema_history WHERE version >= 14 ORDER BY installed_rank').map((r) => `#${r[0]} V${r[1]} "${r[2]}" ${r[3]}`).join(' | ');
say('before', hist());
sql(ENGINE, DB, "UPDATE flyway_schema_history SET version='17', description='managed session operation', script='V17__managed_session_operation.sql' WHERE version='16' AND script='V16__managed_session_operation.sql'");
say('history row renamed to V17', hist());
await tryStart('PR jar, default settings');
await tryStart('PR jar, spring.flyway.out-of-order=true once', ['--spring.flyway.out-of-order=true']);
say('after', hist());
await tryStart('PR jar, default settings again');
const cols = sql(ENGINE, DB, `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='${DB}' AND ((table_name='qwen_runtime_binding' AND column_name LIKE '%evidence%') OR (table_name='qwen_tool_execution' AND column_name IN ('abandoned_at','loss_evidence_id')))`);
say('W0e columns present', cols.map((c) => c.join('.')).join(', '));
stopAll(); process.exit(0);
