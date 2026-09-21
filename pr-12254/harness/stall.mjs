// PR #12254 — does one cold batch stall other daemon requests? Ping /health every 10 ms while the read runs.
// Usage: node stall.mjs <out-dir>   (reuses the run-abort fixture: 20 workspaces x 2500 sessions)
import * as path from 'node:path';
import { writeFileSync, readdirSync } from 'node:fs';
import { startDaemon, http, workspaceIdOf, sleep } from './lib.mjs';

const OUT = process.argv[2] ?? '/root/verify/pr12254-harness/out';
const ROOT = '/root/verify/pr12254-harness/run-abort';
const HOME = path.join(ROOT, 'home');
const WS = readdirSync(ROOT).filter((n) => n.startsWith('ws-')).sort().map((n) => path.join(ROOT, n));
const IDS = WS.map(workspaceIdOf);

async function pool(tasks, n) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < tasks.length) await tasks[i++]();
  }));
}
const strategies = {
  'legacy organized (20 GETs, conc 2)': (d) => pool(IDS.map((id) => () => http(d, 'GET', `/workspaces/${id}/sessions?size=20&view=organized&group=all`)), 2),
  'legacy default   (20 GETs, conc 2)': (d) => pool(IDS.map((id) => () => http(d, 'GET', `/workspaces/${id}/sessions?size=20`)), 2),
  'batch default    (1 POST, 20 members)': (d) => http(d, 'POST', '/sessions/catalog', { workspaces: WS.map((w) => ({ workspace: w })), options: { size: 20 } }),
};
const out = [];
for (const [name, fn] of Object.entries(strategies)) {
  const d = await startDaemon('head', HOME, WS);
  await sleep(3000);
  const pings = [];
  let stop = false;
  const pinger = (async () => {
    while (!stop) {
      const t = performance.now();
      await http(d, 'GET', '/health');
      pings.push(performance.now() - t);
      await sleep(10);
    }
  })();
  await sleep(300);
  const idle = Math.max(...pings);
  pings.length = 0;
  const t0 = performance.now();
  await fn(d);
  const wall = performance.now() - t0;
  stop = true;
  await pinger;
  const sorted = [...pings].sort((a, b) => a - b);
  const row = { strategy: name, wallMs: +wall.toFixed(0), pings: pings.length, idleMaxMs: +idle.toFixed(1), p50: +sorted[Math.floor(sorted.length / 2)].toFixed(1), p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(1), maxMs: +Math.max(...pings).toFixed(1) };
  out.push(row);
  console.log(`${name.padEnd(40)} wall ${String(row.wallMs).padStart(5)} ms | /health while reading: p50 ${row.p50} ms  p99 ${row.p99} ms  max ${row.maxMs} ms  (idle max ${row.idleMaxMs} ms, ${row.pings} pings)`);
  await d.stop();
}
writeFileSync(path.join(OUT, 'stall.json'), JSON.stringify(out, null, 2));
