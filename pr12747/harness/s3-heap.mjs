// S3: heapUsed after full GC, per call and per Session, real workers, base vs PR.
import fs from 'node:fs';
import path from 'node:path';
import { startWorker, post, installation, call, ROUTES, BOOT_V1, BOOT_V2, PR_REPO, BASE_REPO } from './lib.mjs';
const base = fs.realpathSync(fs.mkdtempSync('/tmp/p12747-s3-'));
const home = path.join(base, 'qwen-home');
fs.mkdirSync(home);
const dir = path.join(base, 'ws/services/api');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'f.txt'), 'hello\n');
const probeOut = path.join(base, 'probe-out.json');
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
const N = Number(process.env.N ?? 3000);
const WARM = 200;
const tool = process.argv[3] ?? 'read_file';
const input = tool === 'read_file' ? { file_path: path.join(dir, 'f.txt') } : { command: 'true' };
const start = (repo, boot) => startWorker(boot, { repo, nodeArgs: ['--expose-gc', '--import', path.resolve('probe-mem.mjs')], env: { QWEN_HOME: home, PROBE_OUT: probeOut } });
const mode = process.argv[4] ?? 'calls';
if (mode === 'calls') {
  log(`## per call: ${tool}, ${WARM} warm-up calls, then ${N} calls; heapUsed after 3x gc()`);
  for (const [arm, repo, boot] of [
    ['base boot v1', BASE_REPO, { ...BOOT_V1, workspaceCwd: dir }],
    ['PR   boot v1', PR_REPO, { ...BOOT_V1, workspaceCwd: dir }],
    ['base boot v2', BASE_REPO, { ...BOOT_V2, mountRoot: path.join(base, 'ws') }],
    ['PR   boot v2', PR_REPO, { ...BOOT_V2, mountRoot: path.join(base, 'ws') }],
  ]) {
    const w = await start(repo, boot);
    if (boot.version === 2) await post(w.url, ROUTES.CONTEXT, await installation('s1', 'services/api'), boot);
    let n = 0;
    const run = async (k) => { for (let i = 0; i < k; i++, n++) { const r = await post(w.url, ROUTES.EXECUTE, call('s1', `r${n}`, tool, input), boot); if (r.status !== 200 || r.json.result.executionStatus !== 'success') throw new Error(JSON.stringify(r.json)); } };
    await run(WARM);
    const m0 = await snapshot(w);
    const t0 = performance.now();
    await run(N / 2);
    const mid = await snapshot(w);
    await run(N / 2);
    const ms = (performance.now() - t0) / N;
    const m1 = await snapshot(w);
    log(`${arm}  heapUsed ${MB(m0.heapUsed)} -> ${MB(mid.heapUsed)} -> ${MB(m1.heapUsed)} MiB | +${((m1.heapUsed - m0.heapUsed) / N / 1024).toFixed(2)} KiB/call | ${ms.toFixed(2)} ms/call | RSS ${MB(m1.rss)} MiB`);
    await w.close();
  }
} else {
  // per Session: each new Session = one installation + one call
  const S = Number(process.env.S ?? 1000);
  log(`## per Session: ${S} Sessions, each one installation + one ${tool} call; heapUsed after 3x gc()`);
  for (const [arm, repo] of [['base boot v2', BASE_REPO], ['PR   boot v2', PR_REPO]]) {
    const boot = { ...BOOT_V2, mountRoot: path.join(base, 'ws') };
    const w = await start(repo, boot);
    const one = async (i) => {
      const inst = await post(w.url, ROUTES.CONTEXT, await installation(`sess-${i}`, 'services/api', { operationId: `op-${i}` }), boot);
      if (inst.status !== 200) throw new Error(JSON.stringify(inst.json));
      const r = await post(w.url, ROUTES.EXECUTE, call(`sess-${i}`, `c${i}`, tool, input), boot);
      if (r.status !== 200) throw new Error(JSON.stringify(r.json));
    };
    for (let i = 0; i < 100; i++) await one(`w${i}`);
    const m0 = await snapshot(w);
    for (let i = 0; i < S; i++) await one(i);
    const m1 = await snapshot(w);
    log(`${arm}  heapUsed ${MB(m0.heapUsed)} -> ${MB(m1.heapUsed)} MiB | +${((m1.heapUsed - m0.heapUsed) / S / 1024).toFixed(2)} KiB/Session`);
    await w.close();
  }
}
fs.writeFileSync(process.argv[2] ?? 's3.log', out.join('\n') + '\n');
