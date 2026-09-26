// S2b: two Sessions in different effective directories whose names differ outside ASCII letters/digits.
import fs from 'node:fs';
import path from 'node:path';
import { startWorker, post, installation, call, ROUTES, BOOT_V2, PR_REPO } from './lib.mjs';
const base = fs.realpathSync(fs.mkdtempSync('/tmp/p12747-s2b-'));
const home = path.join(base, 'qwen-home'); fs.mkdirSync(home);
const pairs = [['svc/a-b', 'svc/a/b'], ['svc/数据', 'svc/日志'], ['svc/café', 'svc/cafè']];
for (const p of pairs.flat()) fs.mkdirSync(path.join(base, 'ws', p), { recursive: true });
const w = await startWorker({ ...BOOT_V2, mountRoot: path.join(base, 'ws') }, { repo: PR_REPO, env: { QWEN_HOME: home } });
const out = [];
let n = 0;
for (const [x, y] of pairs) {
  const seen = [];
  for (const rel of [x, y]) {
    const sid = `s-${n++}`;
    await post(w.url, ROUTES.CONTEXT, await installation(sid, rel, { operationId: `op-${sid}` }));
    const r = await post(w.url, ROUTES.EXECUTE, call(sid, `c-${sid}`, 'run_shell_command', { command: 'echo "PDIR=$QWEN_CODE_PROJECT_DIR"' }));
    const t = r.json.result.responseParts[0].text;
    seen.push(/PDIR=(\S+)/.exec(t.slice(t.indexOf('Output:')))[1].replace(home, '$QWEN_HOME').replace(base, '$B'));
  }
  out.push(`${x.padEnd(9)} vs ${y.padEnd(9)} -> ${seen[0] === seen[1] ? 'SAME project dir ' + seen[0].split('/').pop() : 'different'}`);
}
await w.close();
console.log(out.join('\n'));
fs.writeFileSync('logs-s2b.log', out.join('\n') + '\n');
