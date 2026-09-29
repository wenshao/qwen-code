// How long a release takes at the worker, from the ledger of the proxy
// between Broker and worker. usage: node release-latency.mjs "<label>=<db>,<db>" ...
import fs from 'node:fs';
import path from 'node:path';
const RIG = path.dirname(new URL(import.meta.url).pathname);
const lines = [];
for (const arg of process.argv.slice(2)) {
  const [label, dbs] = arg.split('=');
  const ms = [];
  for (const db of dbs.split(',')) {
    const f = path.join(RIG, 'run', `ledger-${db}.jsonl`);
    for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
      const e = JSON.parse(l);
      if (e.kind === 'release' && e.status === 200 && !e.injected) ms.push(e.ms);
    }
  }
  ms.sort((a, b) => a - b);
  const at = (q) => ms[Math.min(ms.length - 1, Math.ceil(q * ms.length) - 1)];
  lines.push(`[release] ${label}: ${ms.length} releases at the worker, median ${at(0.5)} ms, 95th percentile ${at(0.95)} ms, 99th ${at(0.99)} ms, slowest ${ms.at(-1)} ms`);
}
fs.writeFileSync(path.join(RIG, 'out', 'release-latency.log'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
