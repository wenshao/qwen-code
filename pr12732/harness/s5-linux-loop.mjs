// S5: the same remount matrix on Linux ext4 loop mounts (privileged container, real worker).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startWorker, post, installation, call, ROUTES, BOOT_V2, PR_REPO } from './lib.mjs';
const VOL = '/vol';
const M = '/mnt/ws';
fs.mkdirSync(VOL, { recursive: true }); fs.mkdirSync(M, { recursive: true });
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
for (const name of ['A', 'B', 'P', 'Q']) {
  const img = path.join(VOL, `${name}.img`);
  sh('dd', ['if=/dev/zero', `of=${img}`, 'bs=1M', 'count=16', 'status=none']);
  sh('mkfs.ext4', ['-q', '-F', ...(process.env.INODE ? ['-I', process.env.INODE] : []), img]);
  if (name === 'A' || name === 'B') {
    sh('mount', ['-o', 'loop', img, M]);
    fs.mkdirSync(path.join(M, 'services/api'), { recursive: true });
    fs.writeFileSync(path.join(M, 'services/api/volume.txt'), `volume ${name}\n`);
    sh('umount', [M]);
  }
}
const loopOf = () => sh('findmnt', ['-n', '-o', 'SOURCE', M]);
const mount = (n) => { sh('mount', ['-o', 'loop', path.join(VOL, `${n}.img`), M]); return loopOf(); };
const umount = () => sh('umount', [M]);
const id = () => { const s = fs.statSync(M, { bigint: true }); return `dev=${s.dev} ino=${s.ino} birth=${s.birthtimeNs}`; };
const arms = [
  ['PR 42d6f28a51', undefined],
  ['mutant: device check removed', path.join(PR_REPO, 'dist-mut-dev/cli.js')],
  ['candidate: also pin birth time', path.join(PR_REPO, 'dist-cand-birth/cli.js')],
];
const out = [];
const log = (s) => { out.push(s); console.log(s); };
log(`kernel ${sh('uname', ['-r'])}, node ${process.version}`);
for (const [seqName, swap] of [
  ['Sequence 1: B takes the freed loop device (the ordinary remount)', () => { umount(); return `umount A; mount B -> ${mount('B')}`; }],
  ['Sequence 2: B gets another loop device', () => { const p = sh('losetup', ['-f', '--show', path.join(VOL, 'P.img')]); umount(); const q = sh('losetup', ['-f', '--show', path.join(VOL, 'Q.img')]); return `hold ${p} with P, umount A, hold ${q} with Q; mount B -> ${mount('B')}`; }],
]) {
  log(`### ${seqName}`);
  for (const [arm, entry] of arms) {
    const a = mount('A');
    const w = await startWorker({ ...BOOT_V2, mountRoot: M }, { entry });
    if (!w.url) { log(`worker failed: ${w.kind} ${w.code} ${w.stderr.slice(0, 400)}`); process.exit(1); }
    let n = 0;
    const run = async (sid) => {
      const r = await post(w.url, ROUTES.EXECUTE, call(sid, `c${++n}`, 'run_shell_command', { command: 'cat volume.txt' }));
      if (r.status !== 200) return `${r.status} ${r.json?.code}`;
      return `200 ${r.json.result.executionStatus} on "${/Output: (.*)/.exec(r.json.result.responseParts[0].text)?.[1]}"`;
    };
    const inst = async (sid) => { const r = await post(w.url, ROUTES.CONTEXT, await installation(sid, 'services/api')); return `${r.status} ${r.json?.code ?? 'receipt'}`; };
    const i1 = await inst('s1'); const e1 = await run('s1'); const idA = id();
    const how = swap(); const idB = id();
    const e2 = await run('s1'); const i2 = await inst('s2');
    log(`[${arm}]`);
    log(`  A on ${a} (${idA}): install s1 ${i1}; execute ${e1}`);
    log(`  ${how} (${idB})`);
    log(`    execute s1 -> ${e2}`);
    log(`    install s2 -> ${i2}`);
    umount();
    try { sh('losetup', ['-D']); } catch {}
    const a2 = mount('A');
    log(`  back to A on ${a2} (${id()}): execute s1 -> ${await run('s1')}`);
    umount();
    try { sh('losetup', ['-D']); } catch {}
    await w.close();
  }
}
fs.writeFileSync(process.env.OUT ?? '/rig/out-s5.log', out.join('\n') + '\n');
