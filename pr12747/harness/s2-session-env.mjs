// S2: what each Runtime Session's shells see, real boot v2 workers, base vs PR.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startWorker, post, installation, call, ROUTES, BOOT_V1, BOOT_V2, PR_REPO, BASE_REPO } from './lib.mjs';
const base = fs.realpathSync(fs.mkdtempSync('/tmp/p12747-s2-'));
const home = path.join(base, 'qwen-home');
fs.mkdirSync(home);
process.env.QWEN_HOME = home;
const { Storage } = await import(path.join(PR_REPO, 'packages/core/dist/src/config/storage.js'));
const dirs = ['services/api', 'services/web', 'svc/a', 'svc/b', 'svc/c'];
for (const d of dirs) fs.mkdirSync(path.join(base, 'ws', d), { recursive: true });
const root = path.join(base, 'ws');
const out = [];
const log = (s) => { out.push(s); console.log(s); };
const key = (sid) => `runtime-01.${createHash('sha256').update(sid).digest('hex').slice(0, 32)}`;
const pdir = (rel) => new Storage(path.join(root, rel)).getProjectDir();
const short = (s) => (s ?? '').replaceAll(home, '$QWEN_HOME').replaceAll(root, '$WS');
const CMD = 'sleep 0.3; echo "SID=$QWEN_CODE_SESSION_ID PDIR=$QWEN_CODE_PROJECT_DIR PWD=$(pwd)"';
const shell = async (w, sid, callId, boot = BOOT_V2) => {
  const r = await post(w.url, ROUTES.EXECUTE, call(sid, callId, 'run_shell_command', { command: CMD }), boot);
  const text = r.json?.result?.responseParts?.[0]?.text ?? '';
  const m = /SID=([^\s$]*) PDIR=([^\s$]*) PWD=(\/\S*)/.exec(text.slice(text.indexOf('Output:')));
  if (!m) throw new Error(JSON.stringify(r.json));
  return { sid: m[1], pdir: m[2], pwd: m[3] };
};
const verdict = (got, sid, rel) => `${got.sid === key(sid) ? 'own-key' : got.sid === 'runtime-01' ? 'instance-id' : 'OTHER'} / ${got.pdir === pdir(rel) ? 'own-pdir' : 'FOREIGN-pdir(' + short(got.pdir).split('/').pop() + ')'}`;
let tally = {};
for (const [arm, repo] of [['base 89b057b', BASE_REPO], ['PR   3594356', PR_REPO]]) {
  log(`## ${arm} — boot v2, sequential`);
  const w = await startWorker({ ...BOOT_V2, mountRoot: root }, { repo, env: { QWEN_HOME: home } });
  const seq = [['session-api', 'services/api'], ['tenant/../session-web', 'services/web'], ['session-api', 'services/api']];
  for (const [sid] of new Map(seq.map(([s, r]) => [s, r]))) {}
  for (const [i, [sid, rel]] of [['session-api', 'services/api'], ['tenant/../session-web', 'services/web']].entries())
    await post(w.url, ROUTES.CONTEXT, await installation(sid, rel, { operationId: `op-${i}` }));
  for (const [i, [sid, rel]] of seq.entries()) {
    const got = await shell(w, sid, `seq-${i}`);
    log(`  call ${i + 1} ${JSON.stringify(sid).padEnd(24)} cwd=${short(got.pwd).padEnd(18)} SID=${got.sid.padEnd(44)} -> ${verdict(got, sid, rel)}`);
  }
  log(`## ${arm} — boot v2, 3 Sessions x 2 calls concurrently (non-ASCII IDs)`);
  const conc = [['séance', 'svc/a'], ['сессия', 'svc/b'], ['会话', 'svc/c']];
  for (const [i, [sid, rel]] of conc.entries()) await post(w.url, ROUTES.CONTEXT, await installation(sid, rel, { operationId: `op-c${i}` }));
  const calls = [0, 1, 2, 0, 1, 2];
  const got = await Promise.all(calls.map((i, n) => shell(w, conc[i][0], `c-${n}`)));
  const t = {};
  got.forEach((g, n) => { const v = verdict(g, conc[calls[n]][0], conc[calls[n]][1]); t[v] = (t[v] ?? 0) + 1; });
  log(`  6 concurrent calls -> ${JSON.stringify(t)}`);
  await w.close();
  log(`## ${arm} — boot v1 (unchanged expected)`);
  const w1 = await startWorker({ ...BOOT_V1, workspaceCwd: path.join(root, 'services/api') }, { repo, env: { QWEN_HOME: home } });
  const g1 = await shell(w1, 'any', 'v1-1', BOOT_V1);
  log(`  boot v1 shell: SID=${g1.sid} PDIR=${g1.pdir === pdir('services/api') ? 'own-pdir' : short(g1.pdir)} PWD=${short(g1.pwd)}`);
  await w1.close();
}
log(`expected keys: session-api=${key('session-api')}  tenant/../session-web=${key('tenant/../session-web')}`);
fs.writeFileSync(process.argv[2] ?? 's2.log', out.join('\n') + '\n');
