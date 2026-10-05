// VERIFICATION RIG ONLY (PR #13354): every 2 s, snapshot InnoDB transactions (with their connection state/statement) and lock waits.
import * as L from './lib.mjs';
import fs from 'node:fs';
const out = `${L.OUT}/locks.jsonl`;
const until = Date.now() + Number(process.argv[2] ?? 120) * 1000;
while (Date.now() < until) {
  try {
    const trx = await L.sql(`SELECT t.trx_id, t.trx_state, TIMESTAMPDIFF(SECOND, t.trx_started, NOW()) AS age_s, t.trx_rows_locked, p.command, p.time, LEFT(COALESCE(t.trx_query, p.info, ''), 160) AS stmt FROM information_schema.innodb_trx t LEFT JOIN information_schema.processlist p ON p.id = t.trx_mysql_thread_id ORDER BY t.trx_started`);
    const waits = await L.sql(`SELECT w.REQUESTING_ENGINE_TRANSACTION_ID AS req, w.BLOCKING_ENGINE_TRANSACTION_ID AS blk, r.OBJECT_NAME AS tbl, r.INDEX_NAME AS idx, r.LOCK_MODE AS mode FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID`);
    fs.appendFileSync(out, JSON.stringify({ t: new Date().toISOString(), trx, waits }) + '\n');
  } catch (e) { fs.appendFileSync(out, JSON.stringify({ t: new Date().toISOString(), err: String(e) }) + '\n'); }
  await L.sleep(2000);
}
await L.closeDb();
