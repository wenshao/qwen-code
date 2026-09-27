// node probe/agg.mjs <label> <json> <log>: per-test-title tallies for one vitest run.
import fs from 'node:fs';
const [label, jsonFile, logFile] = process.argv.slice(2);
const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
const unhandled = (log.match(/Vitest caught (\d+) unhandled error/) || [0, '0'])[1];
const exit = (log.match(/exit=(\d+)/) || [0, '?'])[1];
const wall = (log.match(/wall=(\d+s)/) || [0, '?'])[1];
const left = (log.match(/leftovers=(\d+)/) || [0, '?'])[1];
let r;
try { r = JSON.parse(fs.readFileSync(jsonFile, 'utf8')); } catch {
  console.log(`${label}\tNO_JSON exit=${exit}\t${log.split('\n').filter(Boolean).slice(-6).join(' | ').slice(0, 500)}`);
  process.exit(0);
}
const short = (t) => t.startsWith('refuses release while an invocation is active, and allows') ? 'release'
  : t.startsWith('retains status and cancel') ? 'dir-loss'
  : t.startsWith('cancels an in-flight call of an installed Session') ? 'd1(context-worker cancel)'
  : t.startsWith('cancels an in-flight shell execution') ? 'd2(tool-worker cancel)'
  : t.startsWith('PROBE') ? t.replace(/ #[+-]?\d+$/, '').replace(/'/g, '') : null;
const groups = new Map();
for (const f of r.testResults) for (const a of f.assertionResults) {
  const key = short(a.title) ?? (a.status === 'failed' ? `OTHER-FAILED: ${a.title.slice(0, 90)}` : null);
  if (!key) continue;
  const g = groups.get(key) ?? { passed: 0, failed: 0, skipped: 0, maxMs: 0, msgs: new Map() };
  if (a.status === 'passed') g.passed++; else if (a.status === 'failed') g.failed++; else g.skipped++;
  g.maxMs = Math.max(g.maxMs, Math.round(a.duration || 0));
  if (a.status === 'failed') {
    const m = (a.failureMessages?.[0] || '').split('\n')[0].replace(/\x1b\[[0-9;]*m/g, '').replace(/[A-Z]:\\[^' ]*|\/[^ ']*qwen-managed-context-[^ ']*/g, '<path>').slice(0, 160);
    g.msgs.set(m, (g.msgs.get(m) ?? 0) + 1);
  }
  groups.set(key, g);
}
console.log(`${label}\tTOTAL passed=${r.numPassedTests} failed=${r.numFailedTests} skipped=${r.numPendingTests + (r.numTodoTests || 0)} unhandled=${unhandled} exit=${exit} wall=${wall} leftovers=${left}`);
for (const [k, g] of groups) {
  console.log(`${label}\t${k}\tpassed=${g.passed} failed=${g.failed} skipped=${g.skipped} maxMs=${g.maxMs}`);
  for (const [m, n] of g.msgs) console.log(`${label}\t  x${n} ${m}`);
}
