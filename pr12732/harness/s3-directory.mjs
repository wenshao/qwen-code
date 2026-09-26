// S3: directory verification + activation gate on real APFS (macOS, non-root), real worker process.
import fs from 'node:fs';
import path from 'node:path';
import { startWorker, post, installation, call, ref, ROUTES, BOOT_V2 } from './lib.mjs';
const base = fs.realpathSync(fs.mkdtempSync('/tmp/p12732-s3-'));
const root = path.join(base, 'ws');
const outside = path.join(base, 'outside');
fs.mkdirSync(path.join(root, 'services/api'), { recursive: true });
fs.mkdirSync(outside, { recursive: true });
const NFD = 'café', NFC = 'café';
fs.mkdirSync(path.join(root, NFD)); // stored in NFD
const w = await startWorker({ ...BOOT_V2, mountRoot: root });
const out = [];
const log = (s) => { out.push(s); console.log(s); };
let n = 0;
const sh = async (sid, cmd = 'pwd') => {
  const id = `c${++n}`;
  const r = await post(w.url, ROUTES.EXECUTE, call(sid, id, 'run_shell_command', { command: cmd }));
  const pwd = /Output: (.*)/.exec(r.json?.result?.responseParts?.[0]?.text ?? '')?.[1];
  return { id, r, s: r.status === 200 ? `200 ${r.json.result.executionStatus} pwd=${pwd?.replace(base, '$BASE')}` : `${r.status} ${r.json?.code}` };
};
const api = path.join(root, 'services/api');
log(`## Session s1 bound to services/api`);
log(`install s1                                   -> ${(await post(w.url, ROUTES.CONTEXT, await installation('s1', 'services/api'))).status}`);
const first = await sh('s1', 'pwd; echo first > probe.txt');
log(`execute ${first.id} (directory present)           -> ${first.s}`);
fs.rmSync(api, { recursive: true });
const gone = await sh('s1', 'echo second > probe.txt');
log(`rm -rf services/api; execute ${gone.id}           -> ${gone.s}`);
const st = await post(w.url, ROUTES.STATUS, ref('s1', gone.id));
log(`status ${gone.id} (the refused call)              -> ${st.status} ${JSON.stringify(st.json?.state ?? st.json)}`);
const replay = await post(w.url, ROUTES.EXECUTE, call('s1', first.id, 'run_shell_command', { command: 'pwd; echo first > probe.txt' }));
log(`replay ${first.id} (already journaled)            -> ${replay.status} ${replay.json?.state}/${replay.json?.result?.executionStatus}`);
log(`services/ now contains: ${JSON.stringify(fs.readdirSync(path.join(root, 'services')))}  (nothing ran elsewhere: probe.txt at root? ${fs.existsSync(path.join(root, 'probe.txt'))})`);
fs.mkdirSync(api);
log(`mkdir services/api again; execute             -> ${(await sh('s1')).s}   (no reinstall needed)`);
fs.rmSync(api, { recursive: true }); fs.symlinkSync(outside, api);
log(`services/api -> symlink to $BASE/outside       -> ${(await sh('s1')).s}`);
fs.unlinkSync(api); fs.mkdirSync(api);
for (const [mode, label] of [[0o000, 'chmod 000'], [0o300, 'chmod 300 (no read)'], [0o600, 'chmod 600 (no search)'], [0o755, 'chmod 755 (restored)']]) {
  fs.chmodSync(api, mode);
  log(`${label.padEnd(45)}-> ${(await sh('s1')).s}`);
}
log(`## New installations (step 6) on APFS (case-insensitive, normalization-preserving)`);
const inst = async (sid, rel, label) => {
  const r = await post(w.url, ROUTES.CONTEXT, await installation(sid, rel));
  log(`install ${sid} ${label.padEnd(36)}-> ${r.status} ${r.json?.code ?? 'receipt'}`);
  return r;
};
await inst('s2', 'Services/API', "'Services/API' (disk: services/api)");
log(`   (ls says the path exists: ${fs.existsSync(path.join(root, 'Services/API'))}; realpath.native -> ${fs.realpathSync.native(path.join(root, 'Services/API')).replace(base, '$BASE')})`);
await inst('s3', NFC, `'${NFC}' NFC (disk stores NFD)`);
await inst('s4', NFD, `'${NFD}' NFD (as stored)`);
await inst('s5', 'services/missing', "'services/missing'");
fs.writeFileSync(path.join(root, 'services/file'), 'x');
await inst('s6', 'services/file', "'services/file' (a regular file)");
fs.symlinkSync(api, path.join(root, 'services/alias'));
await inst('s7', 'services/alias', "'services/alias' (link inside ws)");
log(`execute for never-installed Session s9        -> ${(await sh('s9')).s}`);
log(`execute for refused Session s2                -> ${(await sh('s2')).s}`);
log(`execute for s4 (NFD, installed)               -> ${(await sh('s4')).s}`);
// Repair then retry the very same request: the refusal recorded nothing.
fs.mkdirSync(path.join(root, 'services/missing'));
await inst('s5', 'services/missing', "same request after mkdir (repair)");
log(`stderr bytes: ${w.stderr.length}; token in stderr: ${w.stderr.includes(BOOT_V2.token)}; base path in any 409 body: false by construction`);
fs.writeFileSync(process.argv[2] ?? 's3.log', out.join('\n') + '\n');
await w.close();
