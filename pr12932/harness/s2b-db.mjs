// DB-side time of the page query per Session size (SHOW PROFILES, 5 runs, median).
import fs from 'node:fs';
import path from 'node:path';
import { OUT, TENANT, sql } from './lib.mjs';
const out = {};
for (const engine of ['mysql', 'mariadb']) {
  const db = `s2_pr_${engine}`;
  const sessions = sql(engine, db, `SELECT session_id, COUNT(*) c FROM managed_agent_turn GROUP BY session_id ORDER BY c`);
  out[engine] = [];
  for (const [sid, n] of sessions) {
    const q = `SELECT session_id, turn_id, status, created_at, completed_at, error_code FROM managed_agent_turn WHERE tenant_id='${TENANT}' AND session_id='${sid}' ORDER BY created_at DESC, turn_id DESC LIMIT 21`;
    const oldest = sql(engine, db, `SELECT created_at, turn_id FROM managed_agent_turn WHERE session_id='${sid}' ORDER BY created_at, turn_id LIMIT 30`)[29];
    const qLast = q.replace(' ORDER BY', ` AND (created_at < ${oldest[0]} OR (created_at = ${oldest[0]} AND turn_id < '${oldest[1]}')) ORDER BY`);
    const qDetail = `SELECT session_id, turn_id FROM managed_agent_turn WHERE tenant_id='${TENANT}' AND session_id='${sid}' AND turn_id='${oldest[1]}'`;
    const run = (query) => {
      const rows = sql(engine, db, `SET profiling=1; ${Array(5).fill(query + ';').join(' ')} SHOW PROFILES;`);
      const ms = rows.filter((r) => r.length === 3 && /^\d+$/.test(r[0])).map((r) => Number(r[1]) * 1000).sort((a, b) => a - b);
      return +ms[2].toFixed(2);
    };
    const row = { n: Number(n), firstPageMs: run(q), lastPageMs: run(qLast), detailMs: run(qDetail) };
    out[engine].push(row);
    console.log(engine, JSON.stringify(row));
  }
}
fs.writeFileSync(path.join(OUT, 's2b-db.json'), JSON.stringify(out, null, 2));
