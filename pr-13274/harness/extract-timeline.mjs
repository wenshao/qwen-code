// Build timeline lanes from real run artifacts (provider.jsonl with absolute
// `at` timestamps + the CLI's own debug log). Usage:
//   node extract-timeline.mjs <runsDir> <out.json> <scenario-arm>...
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [runsDir, out, ...runs] = process.argv.slice(2);
const lanes = [];
for (const run of runs) {
  const dir = join(runsDir, run);
  const prov = readFileSync(join(dir, 'provider.jsonl'), 'utf8')
    .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const debugDir = join(dir, 'qwen-home', 'debug');
  const debug = existsSync(debugDir)
    ? readdirSync(debugDir).filter((f) => f.endsWith('.txt'))
        .flatMap((f) => readFileSync(join(debugDir, f), 'utf8').split('\n'))
    : [];
  const stalls = debug
    .filter((l) => l.includes('agent dispatch stalled'))
    .map((l) => Date.parse(l.slice(0, 24)));
  const timeLimit = debug
    .filter((l) => /time limit|TIMEOUT/i.test(l))
    .map((l) => Date.parse(l.slice(0, 24)));
  const children = [...new Set(prov.filter((p) => p.kind === 'child').map((p) => p.child))].sort();
  const firstChildAt = Math.min(...prov.filter((p) => p.kind === 'child').map((p) => p.at));
  for (const child of children) {
    const reqs = prov.filter((p) => p.kind === 'child' && p.child === child);
    const aborts = prov.filter((p) => p.kind === 'child-abort' && p.child === child);
    lanes.push({
      run,
      child,
      requests: reqs.map((r) => ({ t: r.at - firstChildAt, action: r.action })),
      aborts: aborts.map((a) => ({ t: a.at - firstChildAt, after: a.abortedAfterMs })),
      stalls: stalls.map((s) => s - firstChildAt),
      timeLimit: timeLimit.map((s) => s - firstChildAt),
    });
  }
}
writeFileSync(out, JSON.stringify(lanes, null, 1));
console.log(JSON.stringify(lanes));
