// Real worker (node dist/cli.js managed-runtime-worker, boot v2): one Session per effective
// directory, each runs `echo $QWEN_CODE_PROJECT_DIR` through the real Shell tool.
import fs from 'node:fs';
import path from 'node:path';
import { startWorker, post, installation, call, ROUTES, BOOT_V2, PR_REPO } from './lib.mjs';
const base = fs.realpathSync(fs.mkdtempSync('/tmp/p12759-pdir-'));
const home = path.join(base, 'qwen-home'); fs.mkdirSync(home);
const dirs = ['svc/a-b', 'svc/a/b', 'svc/数据', 'svc/日志', 'svc/😀', 'svc/--', 'svc/数'];
for (const d of dirs) fs.mkdirSync(path.join(base, 'ws', d), { recursive: true });
const w = await startWorker({ ...BOOT_V2, mountRoot: path.join(base, 'ws') }, { repo: PR_REPO, env: { QWEN_HOME: home } });
if (w.kind !== 'ready') { console.log('worker did not start', w.kind, w.stderr); process.exit(1); }
const got = {};
let n = 0;
for (const rel of dirs) {
  const sid = `s-${n++}`;
  const inst = await post(w.url, ROUTES.CONTEXT, await installation(sid, rel, { operationId: `op-${sid}` }));
  const r = await post(w.url, ROUTES.EXECUTE, call(sid, `c-${sid}`, 'run_shell_command', { command: 'echo "PDIR=$QWEN_CODE_PROJECT_DIR"; echo "PWD=$PWD"' }));
  const t = r.json.result.responseParts[0].text;
  const out = t.slice(t.indexOf('Output:'));
  got[rel] = { pdir: /PDIR=(\S+)/.exec(out)[1], pwd: /PWD=(\S+)/.exec(out)[1], install: inst.status };
}
await w.close();
const tail = (p) => path.basename(p);
const lines = [`worker: ${PR_REPO}/dist/cli.js managed-runtime-worker (boot v2), mountRoot $B/ws`];
for (const rel of dirs) lines.push(`${rel.padEnd(8)} install ${got[rel].install}  shell PWD=${got[rel].pwd.replace(base, '$B').padEnd(14)}  QWEN_CODE_PROJECT_DIR=.../${tail(got[rel].pdir).replace(/^.*-ws-/, '…-ws-')}`);
const cmp = (x, y) => `${x} vs ${y}: ${got[x].pdir === got[y].pdir ? 'SAME project dir' : 'different'}`;
lines.push('', cmp('svc/a-b', 'svc/a/b'), cmp('svc/数据', 'svc/日志'), cmp('svc/😀', 'svc/--'), cmp('svc/😀', 'svc/数据'), cmp('svc/😀', 'svc/数'));
console.log(lines.join('\n'));
fs.writeFileSync(new URL('./pdir.log', import.meta.url), lines.join('\n') + '\n');
