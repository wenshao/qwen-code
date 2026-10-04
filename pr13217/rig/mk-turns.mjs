// Adds tenant `tt` to r13217_mig: 20 unbound Sessions with TURNS Turns each; every Turn has
// turn.accepted + environment.provisioning + environment.ready + DELTAS deltas + turn.completed.
// Templates: one list-tenant Session (row shapes copied verbatim, ids rewritten).
import { spawnSync } from 'node:child_process';
const TURNS = Number(process.argv[2] ?? 500), DELTAS = Number(process.argv[3] ?? 10), DB = 'r13217_mig';
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const sql = (q) => {
  const r = spawnSync(MYSQL, ['--protocol=tcp', '-h127.0.0.1', '-P13217', '-uroot', '--batch', '--skip-column-names', DB, '-e', q], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(r.stderr + q.slice(0, 300));
  return r.stdout.trim();
};
const t0 = Date.now();
const tpl = sql(`SELECT session_id FROM managed_agent_session WHERE tenant_id = (SELECT tenant_id FROM managed_agent_session WHERE title LIKE 'rig % unbound' LIMIT 1) AND title LIKE 'rig % unbound' AND last_sequence > 0 LIMIT 1`);
const tplTenant = sql(`SELECT tenant_id FROM managed_agent_session WHERE session_id='${tpl}'`);
const tplTurn = sql(`SELECT turn_id FROM managed_agent_turn WHERE tenant_id='${tplTenant}' AND session_id='${tpl}' LIMIT 1`);
for (const t of ['managed_agent_event', 'managed_agent_turn', 'managed_agent_snapshot', 'managed_agent_consumer_progress', 'managed_agent_session']) sql(`DELETE FROM ${t} WHERE tenant_id='tt'`);
sql(`DROP TABLE IF EXISTS rig_n`); sql(`CREATE TABLE rig_n (k INT PRIMARY KEY)`);
sql(`SET SESSION cte_max_recursion_depth = 1000000; INSERT INTO rig_n WITH RECURSIVE s(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM s WHERE k < ${Math.max(TURNS, DELTAS + 5, 20)}) SELECT k FROM s`);
const per = DELTAS + 4; // events per Turn
const cols = (t) => sql(`SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${DB}' AND TABLE_NAME='${t}'`).split(',');
const ins = (t, over, from, where) => {
  const c = cols(t);
  sql(`INSERT INTO ${t} (${c.map((x) => '`' + x + '`').join(',')}) SELECT ${c.map((x) => over[x] ?? `src.\`${x}\``).join(',')} FROM ${from} WHERE ${where}`);
};
// Sessions s = 1..20
ins('managed_agent_session', { tenant_id: "'tt'", session_id: "CONCAT('tt-', s.k)", last_sequence: `${TURNS * per}`, updated_at: 'src.updated_at + s.k', title: "CONCAT('tt ', s.k)" }, `managed_agent_session src JOIN rig_n s ON s.k <= 20`, `src.tenant_id='${tplTenant}' AND src.session_id='${tpl}'`);
// Turns
ins('managed_agent_turn', { tenant_id: "'tt'", session_id: "CONCAT('tt-', s.k)", turn_id: "CONCAT('turn-', t.k)", prompt_id: "CONCAT('p-', s.k, '-', t.k)", created_at: 'src.created_at + t.k', updated_at: 'src.updated_at + t.k', completed_at: 'src.created_at + t.k' }, `managed_agent_turn src JOIN rig_n s ON s.k <= 20 JOIN rig_n t ON t.k <= ${TURNS}`, `src.tenant_id='${tplTenant}' AND src.session_id='${tpl}' AND src.turn_id='${tplTurn}'`);
// Events: per Turn, slot 1 accepted, 2 provisioning, 3 ready, 4..DELTAS+3 deltas, DELTAS+4 completed
const typeOf = `CASE WHEN e.k = 1 THEN 'turn.accepted' WHEN e.k = 2 THEN 'environment.provisioning' WHEN e.k = 3 THEN 'environment.ready' WHEN e.k = ${per} THEN 'turn.completed' ELSE 'item.output_text.delta' END`;
const ec = cols('managed_agent_event');
const over = { tenant_id: "'tt'", session_id: "CONCAT('tt-', s.k)", sequence_id: `(t.k - 1) * ${per} + e.k`, event_id: "CONCAT('ev-', s.k, '-', t.k, '-', e.k)", turn_id: "CONCAT('turn-', t.k)", event_type: typeOf, data_json: "'{}'", terminal: `e.k = ${per}`, source_key: 'NULL', created_at: '0', item_id: 'NULL', content_part_id: 'NULL', schema_version: '1', projection_version: '1' };
const sel = ec.map((x) => over[x] ?? `0`).join(',');
sql(`INSERT INTO managed_agent_event (${ec.map((x) => '`' + x + '`').join(',')}) SELECT ${sel} FROM rig_n s JOIN rig_n t ON t.k <= ${TURNS} JOIN rig_n e ON e.k <= ${per} WHERE s.k <= 20`);
// Snapshot + progress caught up
ins('managed_agent_snapshot', { tenant_id: "'tt'", session_id: "CONCAT('tt-', s.k)", covered_sequence: `${TURNS * per}` }, `managed_agent_snapshot src JOIN rig_n s ON s.k <= 20`, `src.tenant_id='${tplTenant}' AND src.session_id='${tpl}'`);
ins('managed_agent_consumer_progress', { tenant_id: "'tt'", session_id: "CONCAT('tt-', s.k)", covered_sequence: `${TURNS * per}` }, `managed_agent_consumer_progress src JOIN rig_n s ON s.k <= 20`, `src.tenant_id='${tplTenant}' AND src.session_id='${tpl}'`);
sql('DROP TABLE rig_n');
sql('ANALYZE TABLE managed_agent_event, managed_agent_turn');
console.log(`tt: 20 Sessions × ${TURNS} Turns × ${per} events = ${sql("SELECT COUNT(*) FROM managed_agent_event WHERE tenant_id='tt'")} events (${Date.now() - t0} ms); template ${tplTenant}/${tpl}`);
