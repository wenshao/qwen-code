// VERIFICATION RIG ONLY: same searchGlobDirectory call, in-thread (head4 path) vs the bundled
// glob-search-worker.js (head5 Hosted path). Median wall time over RUNS runs per tree size.
import fs from 'node:fs';
import os from 'node:os';
import { Worker } from 'node:worker_threads';

const RIG = '/Users/wenshao/pr13166-rig';
const core = `${RIG}/wt/packages/core/dist/src`;
const { searchGlobDirectory } = await import(`${core}/tools/glob-search.js`);
const { FileDiscoveryService } = await import(`${core}/services/fileDiscoveryService.js`);
const WORKER = `${RIG}/dist/head5/glob-search-worker.js`;
const RUNS = Number(process.env.RUNS ?? 9);
const SIZES = (process.env.SIZES ?? '4,10000,50000,150000').split(',').map(Number);
const PATTERN = process.env.PATTERN ?? '**/needle.md';
const filtering = { respectGitIgnore: true, respectQwenIgnore: true, customIgnoreFiles: ['.qwenignore'] };

function tree(n) {
  const root = `${RIG}/bench/tree-${n}`;
  if (fs.existsSync(`${root}/.done`)) return fs.realpathSync(root);
  fs.mkdirSync(root, { recursive: true });
  for (let d = 0; d < Math.ceil(n / 20); d++) {
    const dir = `${root}/g${String(Math.floor(d / 100)).padStart(3, '0')}/d${String(d).padStart(5, '0')}`;
    fs.mkdirSync(dir, { recursive: true });
    for (let f = 0; f < Math.min(20, n - d * 20); f++) fs.writeFileSync(`${dir}/file-${f}.ts`, '');
  }
  fs.writeFileSync(`${root}/needle.md`, 'needle\n');
  fs.writeFileSync(`${root}/.done`, '');
  return fs.realpathSync(root);
}
const opts = (root) => ({ searchDir: root, pattern: PATTERN, entryLimit: 10000, projectRoot: root, fileFilteringOptions: filtering, containmentRoot: root });
async function inThread(root) {
  const t0 = performance.now();
  const r = await searchGlobDirectory(opts(root), new FileDiscoveryService(root, filtering.customIgnoreFiles), new AbortController().signal);
  return [performance.now() - t0, r.entries.length];
}
async function inWorker(root) {
  const t0 = performance.now();
  const w = new Worker(WORKER, { workerData: opts(root) });
  const reply = await new Promise((res, rej) => { w.once('message', res); w.once('error', rej); });
  await w.terminate();
  return [performance.now() - t0, reply.entries.length];
}
const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const n of SIZES) {
  const root = tree(n);
  const a = [], b = [];
  let hits = '';
  for (let i = 0; i < RUNS; i++) {
    const [ta, ha] = await inThread(root);
    const [tb, hb] = await inWorker(root);
    a.push(ta); b.push(tb); hits = `${ha}/${hb}`;
  }
  console.log(`files=${n} pattern=${PATTERN} hits=${hits} in-thread median=${med(a).toFixed(0)}ms max=${Math.max(...a).toFixed(0)} | worker median=${med(b).toFixed(0)}ms max=${Math.max(...b).toFixed(0)} | delta=${(med(b) - med(a)).toFixed(0)}ms load=${os.loadavg()[0].toFixed(0)}`);
}
