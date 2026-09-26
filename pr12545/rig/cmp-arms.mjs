// node cmp-arms.mjs <SP> <armA> <armB> <scenario>...
import { readFileSync } from 'node:fs';
const [SP, A, B, ...scs] = process.argv.slice(2);
const norm = (v, arm) => String(JSON.stringify(v)).replaceAll(`runs/${arm}-`, 'runs/ARM-').replace(/pid=\d+/g, 'pid=N').replace(/wt-(head|base|fix)/g, 'wt-ARM').replace(/call-(main|sub1|sub2)-\d+/g, 'call-X');
for (const sc of scs) {
  const load = (arm) => JSON.parse(readFileSync(`${SP}/runs/${arm}-${sc}/result.json`, 'utf8')).records.filter((r) => r.role !== 'aux');
  const a = load(A), b = load(B);
  const diffs = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    for (const k of ['role', 'turn', 'phase', 'declared', 'agentDesc', 'execDesc', 'availableSkills', 'lastToolResult'])
      if (norm(a[i]?.[k], A) !== norm(b[i]?.[k], B)) diffs.push(`#${i} ${a[i]?.role}:${k}`);
  console.log(`${A} vs ${B} ${sc}: requests ${a.length}/${b.length} differing=${diffs.length}${diffs.length ? ' -> ' + diffs.join(', ') : ''}`);
}
