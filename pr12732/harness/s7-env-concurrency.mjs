// S7: deferred item 2 (process-wide QWEN_CODE_PROJECT_DIR) + concurrency over real HTTP.
import fs from 'node:fs';
import path from 'node:path';
import { startWorker, post, installation, call, ref, ROUTES, BOOT_V2 } from './lib.mjs';
const base = fs.realpathSync(fs.mkdtempSync('/tmp/p12732-s7-'));
for (const d of ['services/api', 'apps/web']) fs.mkdirSync(path.join(base, d), { recursive: true });
const out = [];
const log = (s) => { out.push(s); console.log(s); };
const w = await startWorker({ ...BOOT_V2, mountRoot: base });
await post(w.url, ROUTES.CONTEXT, await installation('sess-api', 'services/api'));
await post(w.url, ROUTES.CONTEXT, await installation('sess-web', 'apps/web'));
const env = async (sid, id) => {
  const r = await post(w.url, ROUTES.EXECUTE, call(sid, id, 'run_shell_command', { command: 'echo "pwd=$(pwd) QWEN_CODE_PROJECT_DIR=${QWEN_CODE_PROJECT_DIR}"' }));
  return /Output: (.*)/.exec(r.json.result.responseParts[0].text)?.[1]?.replaceAll(base, '$BASE');
};
log('## Deferred item 2: QWEN_CODE_PROJECT_DIR is process-wide');
log(`sess-api (first call in the process): ${await env('sess-api', 'e1')}`);
log(`sess-web (second Session):            ${await env('sess-web', 'e2')}`);
log('## Concurrency over real HTTP');
// 16 concurrent installations of one Session with 16 different contexts (contextRevision differs).
const reqs = await Promise.all(Array.from({ length: 16 }, (_, i) => installation('sess-race', 'services/api', { operationId: `op-race-${i}`, contextRevision: String(i + 1) })));
const res = await Promise.all(reqs.map((r) => post(w.url, ROUTES.CONTEXT, r)));
const tally = res.reduce((m, r) => ((m[`${r.status} ${r.json?.code ?? 'receipt'}`] = (m[`${r.status} ${r.json?.code ?? 'receipt'}`] ?? 0) + 1), m), {});
log(`16 concurrent installs, same Session, 16 different contexts -> ${JSON.stringify(tally)}`);
// 16 concurrent repeats of one identical installation.
const same = await installation('sess-same', 'apps/web', { operationId: 'op-same' });
const res2 = await Promise.all(Array.from({ length: 16 }, () => post(w.url, ROUTES.CONTEXT, same)));
log(`16 concurrent identical installs -> statuses ${[...new Set(res2.map((r) => r.status))]}, distinct receipts: ${new Set(res2.map((r) => JSON.stringify(r.json))).size}`);
// 16 concurrent identical executes that append a line: journaled (and run) once.
const probe = path.join(base, 'apps/web/appends.txt');
const exec = call('sess-same', 'x1', 'run_shell_command', { command: 'echo once >> appends.txt' });
const res3 = await Promise.all(Array.from({ length: 16 }, () => post(w.url, ROUTES.EXECUTE, exec)));
log(`16 concurrent identical executes -> statuses ${[...new Set(res3.map((r) => r.status))]}; lines appended: ${fs.readFileSync(probe, 'utf8').trim().split('\n').length}`);
fs.writeFileSync(process.argv[2] ?? 's7.log', out.join('\n') + '\n');
await w.close();
