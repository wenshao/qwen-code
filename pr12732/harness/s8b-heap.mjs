// S8b: heapUsed after full GC at checkpoints, boot v1 vs boot v2, same PR build.
import fs from 'node:fs';
import path from 'node:path';
import { startWorker, post, installation, call, ROUTES, BOOT_V1, BOOT_V2, PR_REPO, MAIN_REPO } from './lib.mjs';
const base = fs.realpathSync(fs.mkdtempSync('/tmp/p12732-s8b-'));
const dir = path.join(base, 'services/api');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'f.txt'), 'hello\n');
const probeOut = path.resolve('../probe-out.json');
const out = [];
const log = (s) => { out.push(s); console.log(s); };
const snapshot = async (w) => {
  try { fs.unlinkSync(probeOut); } catch {}
  w.child.kill('SIGUSR2');
  for (let i = 0; i < 600 && !fs.existsSync(probeOut); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 200));
  return JSON.parse(fs.readFileSync(probeOut, 'utf8'));
};
const MB = (b) => (b / 1048576).toFixed(1);
const checkpoints = [0, 500, 1000, 2000, 3000];
const tool = process.argv[3] ?? 'read_file';
const input = tool === 'read_file' ? { file_path: path.join(dir, 'f.txt') } : { command: 'true' };
for (const [arm, repo, boot, entry] of [
  ['main boot v1', MAIN_REPO, { ...BOOT_V1, workspaceCwd: dir }],
  ['PR boot v1', PR_REPO, { ...BOOT_V1, workspaceCwd: dir }],
  ['PR boot v2', PR_REPO, { ...BOOT_V2, mountRoot: base }],
  ['candidate (Ajv memo by schema text) boot v2', PR_REPO, { ...BOOT_V2, mountRoot: base }, path.join(PR_REPO, 'dist-cand-ajv/cli.js')],
]) {
  const w = await startWorker(boot, { repo, entry, nodeArgs: ['--expose-gc', '--import', path.resolve('probe-mem.mjs')], env: { PROBE_OUT: probeOut, PROBE_SNAPSHOT: process.env.SNAP ? path.resolve(`../heap-${boot.version}`) : '' } });
  if (boot.version === 2) await post(w.url, ROUTES.CONTEXT, await installation('s1', 'services/api'), boot);
  const row = [];
  const times = [];
  let done = 0;
  let first;
  for (const cp of checkpoints) {
    for (; done < cp; done++) {
      const t0 = performance.now();
      const r = await post(w.url, ROUTES.EXECUTE, call("s1", `r${done}`, tool, input), boot);
      if (done >= 500) times.push(performance.now() - t0);
      if (r.status !== 200 || r.json.result.executionStatus !== 'success') throw new Error(JSON.stringify(r.json));
    }
    const m = await snapshot(w);
    row.push(`${cp}:${MB(m.heapUsed)}`);
    if (cp === 0) first = m.heapUsed;
  }
  times.sort((a, b) => a - b);
  const m = await snapshot(w);
  log(`${arm.padEnd(44)} heapUsed after full GC (MiB) at calls ${row.join("  ")} | +${((m.heapUsed - first) / 3000 / 1024).toFixed(1)} KiB/call | p50 ${times[times.length >> 1].toFixed(2)} ms | RSS ${MB(m.rss)} MiB`);
  await w.close();
}
fs.writeFileSync(process.argv[2] ?? 's8b.log', out.join('\n') + '\n');
