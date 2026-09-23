// Arms F and G. G: restore completes but the prune of a v2-only directory is
// held (WINLOCK_STRICT refuses rmdir of a held directory). F: the rollback hits
// a genuine non-lock errno - the destination is bind-mounted read-only, so each
// unlink returns EROFS - then the fault is cleared.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const a = Object.fromEntries(process.argv.slice(2).map((x) => { const [k, ...v] = x.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const { arm: ARM, dist: DIST, work: WORK, sp: SP, label: LABEL } = a;
const extensionsDir = path.join(WORK, 'extensions'), D = path.join(extensionsDir, 'e2e-lock-probe');
const c = (s, t) => `\u001b[${s}m${t}\u001b[0m`;
console.log(c('1;35', `== arm ${ARM} · ${LABEL} ==`));
const setup = spawnSync(process.execPath, [path.join(SP, 'harness/crash-setup.mjs'), `--dist=${a.setupDist || DIST}`, `--work=${WORK}`, `--sp=${SP}`], { encoding: 'utf8' });
console.log(c(36, 'crash   '), setup.stdout.trim(), setup.stderr.trim().slice(0, 300));
let holder;
console.log(c(36, 'wait    '), 'sleeping 61 s past proper-lockfile stale window left by the SIGKILL'); await new Promise((r) => setTimeout(r, 61000));
const hold = async () => { holder = spawn('python3', [path.join(SP, 'lockfs/holder.py'), extensionsDir], { stdio: ['ignore', 'pipe', 'inherit'] }); console.log(c(36, 'holder  '), String(await new Promise((r) => holder.stdout.once('data', r))).trim()); };
const env = { ...process.env, LD_PRELOAD: path.join(SP, 'lockfs/winlock.so'), WINLOCK_ROOT: extensionsDir, ...(ARM === 'G' ? { WINLOCK_STRICT: '1' } : {}) };
const t0 = Date.now();
const op = (name, extra = []) => {
  const r = spawnSync(process.execPath, [path.join(SP, 'harness/op.mjs'), `--dist=${DIST}`, `--work=${WORK}`, `--op=${name}`, ...extra], { env, encoding: 'utf8' });
  let j; try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { j = { raw: r.stdout + r.stderr }; }
  const head = j.ok ? c(32, `OK   gen=${j.generation}`) : c('1;31', `ERR  ${j.err}`);
  console.log(`${c(2, `t+${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(4)}s`)} ${name.padEnd(10)} ${head}`);
  console.log(`         ${c(2, `manifest=${j.manifest} payload=${j.payload} top=${JSON.stringify(j.top)} journals=${JSON.stringify(j.journals)}`)}`);
  return j;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (ARM === 'G') {
  await hold();
  op('read'); await sleep(1000); op('read'); op('update', ['--version=3.0.0']);
  holder.kill('SIGKILL'); console.log(c(36, 'release '), 'holder killed');
  op('read'); await sleep(6000); op('read'); op('update', ['--version=4.0.0']);
} else {
  spawnSync('mount', ['--bind', D, D]); spawnSync('mount', ['-o', 'remount,bind,ro', D]);
  let probe = ''; try { fs.unlinkSync(path.join(D, 'payload', 'f0000.bin')); } catch (e) { probe = `${e.code} ${e.syscall}`; }
  console.log(c(36, 'fault   '), `destination bind-mounted read-only; ground truth unlink -> ${probe}`);
  await hold();
  op('read'); await sleep(1000); op('read'); await sleep(1000); op('read'); op('update', ['--version=3.0.0']);
  await sleep(4000); op('read');
  holder.kill('SIGKILL'); spawnSync('umount', [D]); console.log(c(36, 'clear   '), 'read-only bind mount removed, holder released');
  op('read'); await sleep(6000); op('read'); op('update', ['--version=4.0.0']);
}
spawnSync('umount', [D]);
