import { readFileSync } from 'node:fs';
const SP = process.argv[2];
const norm = (v, arm) => JSON.stringify(v).replaceAll(`runs/${arm}-`, 'runs/ARM-').replace(/pid=\d+/g, 'pid=N').replace(/wt-(head|base)/g, 'wt-ARM').replace(/call-(main|sub1|sub2)-\d+/g,'call-X');
for (const sc of process.argv.slice(3)) {
  const load = (arm) => JSON.parse(readFileSync(`${SP}/runs/${arm}-${sc}/result.json`, 'utf8')).records.filter(r => r.role !== 'aux');
  const b = load('base'), h = load('head');
  const diffs = [];
  const n = Math.max(b.length, h.length);
  for (let i = 0; i < n; i++) {
    for (const k of ['role', 'turn', 'declared', 'agentDesc', 'execDesc', 'availableSkills', 'lastToolResult']) {
      if (norm(b[i]?.[k], 'base') !== norm(h[i]?.[k], 'head')) diffs.push(`#${i} ${b[i]?.role}:${k}`);
    }
  }
  console.log(`${sc}: requests base=${b.length} head=${h.length} differing fields=${diffs.length}${diffs.length ? ' -> ' + diffs.slice(0, 8).join(', ') : ''}`);
}
