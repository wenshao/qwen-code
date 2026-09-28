// S2: cost of the Turn list on long Sessions. The page query has no index that
// covers its sort (PK is tenant, session, turn), so every page sorts the
// Session's Turns. Bulk-inserts N Turns per Session and times real HTTP reads.
// usage: node s2-perf.mjs <engine>
import fs from 'node:fs';
import path from 'node:path';
import { SP, OUT, TENANT, openLog, say, sql, freshDb, startSpring, api, createSession } from './lib.mjs';

const ENGINE = process.argv[2] ?? 'mysql';
const DB = `s2_pr_${ENGINE}`;
const P = { spring: { mysql: 19401, mariadb: 19402 }[ENGINE] };
openLog(`s2-perf-${ENGINE}`);
freshDb(ENGINE, DB);
await startSpring(`s2-${ENGINE}`, { jar: path.join(SP, 'jars', 'pr-server.jar'), engine: ENGINE, db: DB, port: P.spring, harnessPort: 1, storePort: P.spring, harness: false });
const S = P.spring;
const digits = '(SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)';
function fill(sid, n) {
  const pow = Math.round(Math.log10(n));
  const from = Array.from({ length: pow }, (_, i) => `${digits} d${i}`).join(' CROSS JOIN ');
  const num = Array.from({ length: pow }, (_, i) => `d${i}.d*${10 ** i}`).join('+');
  sql(ENGINE, DB, `INSERT INTO managed_agent_turn (tenant_id, session_id, turn_id, prompt_id, input_json, payload_digest, status, created_at, updated_at, completed_at)
    SELECT '${TENANT}', '${sid}', CONCAT('turn_', MD5(CONCAT('${sid}', n))), UUID(), '[{"type":"input_text","text":"x"}]', 'd', 'COMPLETED',
      1700000000000 + n * 1000 - (n % 7 = 0) * 1000, 1700000000000 + n * 1000, 1700000000000 + n * 1000 + 500
    FROM (SELECT ${num} AS n FROM ${from}) nums`);
}
async function time(url, reps = 7) {
  const ms = [];
  let last;
  for (let i = 0; i < reps; i++) {
    const t = performance.now();
    last = await api(S, 'GET', url);
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  return { median: ms[Math.floor(reps / 2)], status: last.status, body: last.json };
}
const results = [];
for (const n of [1_000, 10_000, 100_000]) {
  const sid = await createSession(S, {});
  const t = performance.now();
  fill(sid, n);
  const count = sql(ENGINE, DB, `SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='${sid}'`)[0][0];
  say('fill', `${count} Turns in ${((performance.now() - t) / 1000).toFixed(1)} s`);
  const base = `/v1/agents/sessions/${sid}/turns`;
  const first20 = await time(base);
  const first100 = await time(`${base}?limit=100`);
  // A cursor near the oldest Turn: the last page.
  const oldest = sql(ENGINE, DB, `SELECT created_at, turn_id FROM managed_agent_turn WHERE session_id='${sid}' ORDER BY created_at, turn_id LIMIT 30`);
  const [ca, tid] = oldest[29];
  const lastPage = await time(`${base}?cursor=${Buffer.from(`${ca}:${tid}`).toString('base64url')}`);
  const detail = await time(`${base}/${first20.body.data[5].id}`);
  let walk = null;
  if (n <= 10_000) {
    const t0 = performance.now();
    let cursor = null;
    let pages = 0;
    const seen = new Set();
    do {
      const r = await api(S, 'GET', `${base}?limit=100${cursor ? '&cursor=' + cursor : ''}`);
      r.json.data.forEach((x) => seen.add(x.id));
      cursor = r.json.next_cursor;
      pages++;
    } while (cursor);
    walk = { pages, seen: seen.size, seconds: (performance.now() - t0) / 1000 };
  }
  const plan = sql(ENGINE, DB, `EXPLAIN SELECT session_id, turn_id, status, created_at, completed_at, error_code FROM managed_agent_turn WHERE tenant_id='${TENANT}' AND session_id='${sid}' ORDER BY created_at DESC, turn_id DESC LIMIT 21`);
  const row = { n: Number(count), first20: first20.median, first100: first100.median, lastPage: lastPage.median, lastPageSize: lastPage.body.data?.length, detail: detail.median, walk, plan: plan.map((p) => p.join(' | ')) };
  results.push(row);
  say('RESULT', JSON.stringify(row));
}
fs.writeFileSync(path.join(OUT, `s2-perf-${ENGINE}.json`), JSON.stringify(results, null, 2));
process.exit(0);
