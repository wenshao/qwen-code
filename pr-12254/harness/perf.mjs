// PR #12254 — latency: one batch POST vs the 2W legacy GETs it replaces. Head daemon only.
// Usage: node perf.mjs <out-dir>
import * as path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startDaemon, http, writeSession, freshDir, sid, workspaceIdOf, sleep } from './lib.mjs';

const OUT = process.argv[2] ?? '/root/verify/pr12254-harness/out';
const RUNS = 7;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const results = [];

async function pool(tasks, n) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < tasks.length) await tasks[i++]();
  }));
}

for (const [W, N] of [[3, 200], [3, 2000], [10, 1000]]) {
  const ROOT = freshDir(`/root/verify/pr12254-harness/run-perf-${W}x${N}`);
  const HOME = path.join(ROOT, 'home');
  mkdirSync(path.join(HOME, '.qwen'), { recursive: true });
  const WS = Array.from({ length: W }, (_, i) => path.join(ROOT, `ws-${i + 1}`));
  WS.forEach((w, wi) => {
    mkdirSync(w, { recursive: true });
    for (let i = 1; i <= N; i++) writeSession(HOME, w, sid('A', wi * 100000 + i), { minute: i % 59, title: `session ${i}` });
  });
  const d = await startDaemon('head', HOME, WS);
  await sleep(3000);
  const IDS = WS.map(workspaceIdOf);
  const members = WS.map((w) => ({ workspace: w }));
  const strategies = {
    // what a sidebar does today: sessions + groups per workspace, 2 in flight (the Web Shell's pacing)
    'legacy default  (2W GETs, conc 2)': () => pool(IDS.flatMap((id) => [() => http(d, 'GET', `/workspaces/${id}/sessions?size=20`), () => http(d, 'GET', `/workspaces/${id}/session-groups`)]), 2),
    'legacy organized(2W GETs, conc 2)': () => pool(IDS.flatMap((id) => [() => http(d, 'GET', `/workspaces/${id}/sessions?size=20&view=organized&group=all`), () => http(d, 'GET', `/workspaces/${id}/session-groups`)]), 2),
    'batch default   (1 POST)': () => http(d, 'POST', '/sessions/catalog', { workspaces: members, options: { size: 20 }, includeGroups: true }),
    'batch organized (1 POST)': () => http(d, 'POST', '/sessions/catalog', { workspaces: members, options: { size: 20, view: 'organized', group: 'all' }, includeGroups: true }),
  };
  for (const [name, fn] of Object.entries(strategies)) {
    const cold = [];
    const warm = [];
    for (let r = 0; r < RUNS; r++) {
      await sleep(2300); // persisted snapshot cache TTL is 2 s → next read is cold
      let t = performance.now();
      await fn();
      cold.push(performance.now() - t);
      t = performance.now();
      await fn();
      warm.push(performance.now() - t);
    }
    const row = { W, N, strategy: name, requests: name.startsWith('batch') ? 1 : 2 * W, coldMs: +median(cold).toFixed(1), warmMs: +median(warm).toFixed(1) };
    results.push(row);
    console.log(`${W}x${N}  ${name.padEnd(36)} req=${String(row.requests).padStart(2)}  cold ${String(row.coldMs).padStart(7)} ms   warm ${String(row.warmMs).padStart(6)} ms`);
  }
  await d.stop();
}
writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(results, null, 2));
