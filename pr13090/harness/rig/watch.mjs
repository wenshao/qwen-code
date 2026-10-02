// PR #13087 rig: sample collector state for some sessions until every publication is
// COLLECTED (or a timeout), writing out/watch-<tag>.jsonl.
// usage: DB=.. node watch.mjs <tag> <timeoutSec> <sessionId>...
import fs from 'node:fs';
import * as L from './lib.mjs';
const [tag, timeoutSec, ...sessions] = process.argv.slice(2);
const DB = process.env.DB ?? 'o4m';
const out = `${L.RIG}/out/watch-${tag}.jsonl`;
fs.writeFileSync(out, '');
const list = sessions.map((s) => `'${s}'`).join(',');
const pubs = L.sql(DB, `SELECT publication_id, scope_key, session_id FROM qwen_tool_publication WHERE session_id IN (${list}) ORDER BY session_id, publication_id`);
const t0 = Date.now();
let last = '';
for (;;) {
  const rows = L.sql(DB, `SELECT publication_id, retention_state, gc_generation, IFNULL(gc_owner,'-'), IFNULL(gc_blocker,'-'), gc_cursor, capture_held_bytes+producer_held_bytes+admission_held_bytes, capture_used_bytes+producer_used_bytes+admission_used_bytes, IFNULL(released_held_bytes,'-'), gc_next_at - UNIX_TIMESTAMP(NOW(3))*1000 FROM qwen_tool_publication WHERE session_id IN (${list}) ORDER BY session_id, publication_id`);
  const sample = { ms: Date.now() - t0, pubs: [] };
  for (const r of rows) {
    const p = pubs.find((x) => x[0] === r[0]);
    const st = await L.oss(`/state?prefix=${encodeURIComponent(`managed-tool-results/${p[1]}/${r[0]}/`)}`);
    sample.pubs.push({ id: r[0].slice(0, 8), state: r[1], gen: +r[2], owner: r[3].slice(0, 8), blocker: r[4], cursor: r[5], held: +r[6], used: +r[7], released: r[8], nextInMs: +r[9], ossLeft: st.objects });
  }
  const key = JSON.stringify(sample.pubs.map(({ nextInMs, ...p }) => p));
  if (key !== last) {
    fs.appendFileSync(out, JSON.stringify(sample) + '\n');
    console.log(`+${(sample.ms / 1000).toFixed(1)}s ` + sample.pubs.map((p) => `${p.id} ${p.state} g${p.gen} ${p.blocker} cur=${p.cursor || '-'} held=${p.held} oss=${p.ossLeft}`).join(' | '));
    last = key;
  }
  if (rows.every((r) => r[1] === 'COLLECTED') || Date.now() - t0 > Number(timeoutSec) * 1000) break;
  await L.sleep(150);
}
