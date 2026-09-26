// S4b: remount matrix on macOS (hdiutil, no root) x three worker builds.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startWorker, post, installation, call, ROUTES, BOOT_V2, PR_REPO } from './lib.mjs';
const VOL = path.resolve('../vol2');
const M = path.join(VOL, 'mnt'), MP = path.join(VOL, 'mntP'), MQ = path.join(VOL, 'mntQ');
for (const d of [M, MP, MQ]) fs.mkdirSync(d, { recursive: true });
const hd = (...a) => execFileSync('hdiutil', a, { encoding: 'utf8' });
const node = (out) => /\/dev\/(disk\d+)s1/.exec(out)?.[1];
const attach = (img, at = M) => node(hd('attach', path.join(VOL, `vol${img}.dmg`), '-mountpoint', at, '-nobrowse'));
const detach = (at = M) => hd('detach', at);
for (const name of ['P', 'Q']) {
  const img = path.join(VOL, `vol${name}.dmg`);
  if (!fs.existsSync(img)) hd('create', '-size', '10m', '-fs', 'APFS', '-volname', `P12732${name}`, '-o', img);
}
const id = () => { const s = fs.statSync(M, { bigint: true }); return `dev=${s.dev} ino=${s.ino}`; };
const arms = [
  ['PR 42d6f28a51', undefined],
  ['mutant: device check removed', path.join(PR_REPO, 'dist-mut-dev/cli.js')],
  ['candidate: also pin birth time', path.join(PR_REPO, 'dist-cand-birth/cli.js')],
];
const out = [];
const log = (s) => { out.push(s); console.log(s); };
for (const [seqName, swapToB] of [
  ['Sequence 1: volume B takes the freed device node (the ordinary remount)', () => { detach(); return `detach A; attach B at mnt -> ${attach('B')}`; }],
  ['Sequence 2: volume B gets a new device node', () => { const p = attach('P', MP); detach(); const q = attach('Q', MQ); return `hold ${p} with P, detach A, hold ${q} with Q; attach B at mnt -> ${attach('B')}`; }],
]) {
  log(`### ${seqName}`);
  for (const [arm, entry] of arms) {
    const a = attach('A');
    const w = await startWorker({ ...BOOT_V2, mountRoot: M }, { entry });
    let n = 0;
    const run = async (sid) => {
      const r = await post(w.url, ROUTES.EXECUTE, call(sid, `c${++n}`, 'run_shell_command', { command: 'cat volume.txt' }));
      if (r.status !== 200) return `${r.status} ${r.json?.code}`;
      return `200 ran on "${/Output: (.*)/.exec(r.json.result.responseParts[0].text)?.[1]}"`;
    };
    const inst = async (sid) => { const r = await post(w.url, ROUTES.CONTEXT, await installation(sid, 'services/api')); return `${r.status} ${r.json?.code ?? 'receipt'}`; };
    const i1 = await inst('s1'); const e1 = await run('s1'); const idA = id();
    const how = swapToB(); const idB = id();
    const e2 = await run('s1'); const i2 = await inst('s2');
    log(`[${arm}]`);
    log(`  A on ${a} (${idA}): install s1 ${i1}; execute ${e1}`);
    log(`  ${how} (${idB})`);
    log(`    execute s1 -> ${e2}`);
    log(`    install s2 -> ${i2}`);
    for (const at of [M, MP, MQ]) { try { detach(at); } catch {} }
    const a2 = attach('A');
    log(`  back to A on ${a2} (${id()}): execute s1 -> ${await run('s1')}`);
    detach();
    await w.close();
  }
}
fs.writeFileSync(process.argv[2] ?? 's4b.log', out.join('\n') + '\n');
