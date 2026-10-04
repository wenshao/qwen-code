// Builds r13217_mig: the main (V35) schema copied from a main-built database,
// then the template database's sessions replicated N times per tenant with
// suffixed ids. Usage: node scale.mjs <schemaSourceDb> <templateDb> <targetDb> <copies>
import { spawnSync } from 'node:child_process';

const [schemaDb, templateDb, target, copiesArg] = process.argv.slice(2);
const copies = Number(copiesArg);
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
function sql(query, db) {
  const args = ['--protocol=tcp', '-h127.0.0.1', '-P13217', '-uroot', '--batch', '--skip-column-names'];
  if (db) args.push(db);
  const r = spawnSync(MYSQL, [...args, '-e', query], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`${r.stderr}\n${query.slice(0, 400)}`);
  return r.stdout.trim();
}
const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, ...a);

sql(`DROP DATABASE IF EXISTS ${target}`);
sql(`CREATE DATABASE ${target} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
const tables = sql(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${schemaDb}' AND TABLE_TYPE='BASE TABLE'`).split('\n');
for (const t of tables) sql(`CREATE TABLE ${target}.\`${t}\` LIKE ${schemaDb}.\`${t}\``);
sql(`INSERT INTO ${target}.flyway_schema_history SELECT * FROM ${schemaDb}.flyway_schema_history`);
log('schema', tables.length, 'tables, version', sql(`SELECT MAX(CAST(version AS UNSIGNED)) FROM ${target}.flyway_schema_history`));

sql(`CREATE TABLE ${target}.rig_seq (k INT PRIMARY KEY)`);
sql(`INSERT INTO ${target}.rig_seq (k) WITH RECURSIVE s(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM s WHERE k < ${copies}) SELECT k FROM s`);

const cols = (t) => sql(`SELECT GROUP_CONCAT(CONCAT('\`', COLUMN_NAME, '\`') ORDER BY ORDINAL_POSITION) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${target}' AND TABLE_NAME='${t}'`).split(',');
// Columns rewritten per copy; everything else is copied verbatim.
const rewrite = {
  session_id: "CONCAT(src.session_id, '-', s.k)",
  prompt_id: "CONCAT(LEFT(src.prompt_id, 28), '-', LPAD(s.k, 7, '0'))",
  event_id: "CONCAT(LEFT(src.event_id, 52), '-', s.k)",
  operation_id: "CONCAT(LEFT(src.operation_id, 52), '-', s.k)",
  // Spread the copies in time so pages interleave templates.
  updated_at: 'src.updated_at - s.k * 1000',
};
function copy(table, where = '1=1') {
  const c = cols(table);
  const select = c.map((name) => {
    const bare = name.replaceAll('`', '');
    return rewrite[bare] && (table !== 'managed_agent_session' || bare !== 'updated_at' || true) ? `${rewrite[bare]}` : `src.${name}`;
  });
  const t = Date.now();
  sql(`INSERT INTO ${target}.\`${table}\` (${c.join(',')}) SELECT ${select.join(',')} FROM ${templateDb}.\`${table}\` src CROSS JOIN ${target}.rig_seq s WHERE ${where}`);
  log('copied', table, sql(`SELECT COUNT(*) FROM ${target}.\`${table}\``), `${Date.now() - t}ms`);
}
for (const t of ['managed_agent_session', 'managed_agent_turn', 'managed_agent_event', 'managed_agent_snapshot', 'managed_agent_consumer_progress', 'managed_agent_operation']) {
  if (sql(`SELECT COUNT(*) FROM ${templateDb}.\`${t}\``) !== '0') copy(t);
}
sql(`INSERT INTO ${target}.managed_workspace_registry SELECT * FROM ${templateDb}.managed_workspace_registry`);
sql(`INSERT INTO ${target}.managed_workspace_access SELECT * FROM ${templateDb}.managed_workspace_access`);
sql(`UPDATE ${target}.managed_workspace_access SET can_read = TRUE`);
sql(`DROP TABLE ${target}.rig_seq`);
sql(`ANALYZE TABLE ${target}.managed_agent_event, ${target}.managed_agent_session, ${target}.managed_agent_turn`);
log('done', sql(`SELECT ROUND(SUM(data_length + index_length) / 1048576) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${target}'`), 'MiB');
