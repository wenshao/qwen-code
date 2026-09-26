// S3b: root replacement on APFS (inode numbers are not reused), real worker.
import fs from 'node:fs';
import path from 'node:path';
import { startWorker, post, installation, call, ROUTES, BOOT_V2 } from './lib.mjs';
const base = fs.realpathSync(fs.mkdtempSync('/tmp/p12732-s3b-'));
const out = [];
const log = (s) => { out.push(s); console.log(s); };
const mk = (d) => { fs.mkdirSync(path.join(d, 'services/api'), { recursive: true }); fs.writeFileSync(path.join(d, 'services/api/who.txt'), path.basename(d) + '\n'); };
const ino = (p) => fs.statSync(p).ino;
async function scenario(label, mountRoot, mutate) {
  const w = await startWorker({ ...BOOT_V2, mountRoot });
  await post(w.url, ROUTES.CONTEXT, await installation('s1', 'services/api'));
  const run = async (id) => { const r = await post(w.url, ROUTES.EXECUTE, call('s1', id, 'run_shell_command', { command: 'cat who.txt' })); return r.status === 200 ? `200 ran on "${/Output: (.*)/.exec(r.json.result.responseParts[0].text)?.[1]}"` : `${r.status} ${r.json?.code}`; };
  const before = await run('a');
  const how = mutate();
  log(`${label.padEnd(58)} before: ${before}; ${how} -> ${await run('b')}`);
  await w.close();
}
const r1 = path.join(base, 'root1'); mk(r1);
await scenario('root deleted and recreated in place (same path)', r1, () => { const i0 = ino(r1); fs.rmSync(r1, { recursive: true }); mk(r1); return `ino ${i0} -> ${ino(r1)}`; });
const r2 = path.join(base, 'root2'); mk(r2);
await scenario('root moved aside, another directory moved in', r2, () => { fs.renameSync(r2, r2 + '.old'); const other = path.join(base, 'other'); mk(other); fs.renameSync(other, r2); return 'mv root root.old; mv other root'; });
const t1 = path.join(base, 'target1'), t2 = path.join(base, 'target2'), link = path.join(base, 'link-root'); mk(t1); mk(t2); fs.symlinkSync(t1, link);
await scenario('root reached through a link (allowed), link retargeted', link, () => { fs.unlinkSync(link); fs.symlinkSync(t2, link); return 'ln -sfn target2 link-root'; });
fs.writeFileSync(process.argv[2] ?? 's3b.log', out.join('\n') + '\n');
