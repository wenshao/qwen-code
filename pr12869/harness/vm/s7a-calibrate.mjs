// Where does the maintenance window sit relative to last_reconciled_at? (rig calibration only)
import * as d from './drive.mjs';
const sid = process.argv[2];
const row = () => Number(d.sql(`SELECT UNIX_TIMESTAMP(last_reconciled_at)*1000 FROM qwen_runtime_binding WHERE isolation_key='${sid}' ORDER BY runtime_generation DESC LIMIT 1`)[0][0]);
const seen = []; let last = row();
while (seen.length < 2) { await d.sleep(40); const v = row(); if (v !== last) { seen.push(v); last = v; } }
const period = seen[1] - seen[0]; let predicted = seen[1] + period;
console.log('period', period.toFixed(1));
const leads = [120, 100, 80, 70, 60, 50, 40, 30, 20, 10, 0, -10];
for (let cycle = 0; cycle < 5; cycle++) {
  const results = await Promise.all(leads.map(async (lead) => {
    const at = predicted - lead;
    while (Date.now() < at) await new Promise((r) => setTimeout(r, 1));
    const r = await d.warm(sid, { timeoutMs: 10000 });
    return `${lead}:${r.status === 200 ? 'ok' : r.status}`;
  }));
  await d.sleep(300);
  const actual = row();
  console.log(`cycle ${cycle}: predicted completion ${predicted.toFixed(0)} actual ${actual.toFixed(0)} (error ${(actual - predicted).toFixed(0)} ms) leads(ms):`, results.join(' '));
  predicted = actual + period;
}
