// S2: #12380 acceptance on real workers: two Workspaces x Sessions in different child directories.
import fs from 'node:fs';
import path from 'node:path';
import { startWorker, post, installation, call, ROUTES, BOOT_V2 } from './lib.mjs';
const base = fs.realpathSync(fs.mkdtempSync('/tmp/p12732-s2-'));
const W = { W1: path.join(base, 'workspace-1'), W2: path.join(base, 'workspace-2') };
for (const w of Object.values(W)) {
  for (const d of ['services/api', 'apps/web']) fs.mkdirSync(path.join(w, d), { recursive: true });
  fs.writeFileSync(path.join(w, 'README.md'), `root of ${path.basename(w)}\n`);
}
const plan = [
  ['W1', 'sess-api', 'services/api'],
  ['W1', 'sess-web', 'apps/web'],
  ['W1', 'sess-root', '.'],
  ['W2', 'sess-api', 'services/api'], // same Session ID + cwdRelative, other Workspace
];
const workers = {};
for (const [name, root] of Object.entries(W)) {
  workers[name] = await startWorker({ ...BOOT_V2, mountRoot: root, workspaceId: BOOT_V2.workspaceId });
}
const out = [];
const log = (s) => { out.push(s); console.log(s); };
log(`mount roots: W1=${W.W1.replace(base, '$BASE')}  W2=${W.W2.replace(base, '$BASE')}`);
let n = 0;
for (const [w, sid, rel] of plan) {
  const url = workers[w].url;
  const inst = await post(url, ROUTES.CONTEXT, await installation(sid, rel));
  const eff = path.join(W[w], rel);
  const sh = await post(url, ROUTES.EXECUTE, call(sid, `c${++n}`, 'run_shell_command', { command: `pwd; echo ${w}:${sid} > shell.txt` }));
  const pwd = /Output: (.*)/.exec(sh.json?.result?.responseParts?.[0]?.text ?? '')?.[1];
  const wr = await post(url, ROUTES.EXECUTE, call(sid, `c${++n}`, 'write_file', { file_path: path.join(eff, 'note.txt'), content: `draft by ${w}:${sid}` }));
  const ed = await post(url, ROUTES.EXECUTE, call(sid, `c${++n}`, 'edit', { file_path: path.join(eff, 'note.txt'), old_string: 'draft', new_string: 'final' }));
  const rd = await post(url, ROUTES.EXECUTE, call(sid, `c${++n}`, 'read_file', { file_path: path.join(eff, 'note.txt') }));
  const rdText = JSON.stringify(rd.json?.result?.responseParts ?? '');
  log(`${w} ${sid.padEnd(9)} cwdRelative=${rel.padEnd(12)} install=${inst.status}  shell pwd=${pwd?.replace(base, '$BASE')}  write=${wr.json?.result?.executionStatus} edit=${ed.json?.result?.executionStatus} read=${rd.json?.result?.executionStatus}${rdText.includes(`final by ${w}:${sid}`) ? ' (content ok)' : ' (CONTENT MISMATCH)'}`);
}
// Where did every file land?
log('--- files on disk (find $BASE -name "*.txt") ---');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk(base).filter((f) => f.endsWith('.txt')).sort()) log(`${f.replace(base, '$BASE').padEnd(40)} ${fs.readFileSync(f, 'utf8').trim()}`);
// Cross-Session probes within W1: sess-api reaches for sess-web's directory and the Workspace root.
log('--- W1 sess-api reaching outside its effective directory ---');
const u = workers.W1.url;
const probes = [
  ['read_file', { file_path: path.join(W.W1, 'apps/web/note.txt') }, 'read sibling Session file (absolute)'],
  ['write_file', { file_path: path.join(W.W1, 'apps/web/intrude.txt'), content: 'x' }, 'write into sibling Session dir (absolute)'],
  ['read_file', { file_path: path.join(W.W1, 'README.md') }, 'read Workspace-root README (absolute)'],
  ['run_shell_command', { command: 'cat ../../apps/web/note.txt' }, 'shell cat ../../apps/web/note.txt'],
  ['run_shell_command', { command: 'echo x', directory: path.join(W.W1, 'apps/web') }, 'shell with directory=sibling Session dir'],
];
for (const [tool, input, label] of probes) {
  const r = await post(u, ROUTES.EXECUTE, call('sess-api', `c${++n}`, tool, input));
  const res = r.json?.result;
  const msg = (res?.error?.message ?? JSON.stringify(res?.responseParts ?? r.json)).replace(new RegExp(base, 'g'), '$BASE').replace(/\\n/g, ' | ').slice(0, 150);
  log(`${label.padEnd(44)} -> ${r.status} ${res?.executionStatus ?? r.json?.code}: ${msg}`);
}
log(`intrude.txt exists: ${fs.existsSync(path.join(W.W1, 'apps/web/intrude.txt'))}`);
fs.writeFileSync(process.argv[2] ?? 's2.log', out.join('\n') + '\n');
for (const w of Object.values(workers)) await w.close();
