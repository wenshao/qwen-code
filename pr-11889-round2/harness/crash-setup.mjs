// Shared setup for arms F and G: install v1 by the ordinary rename path, then
// SIGKILL a copy-mode update to v2 mid-copy while a real holder keeps the
// directory lock. Leaves a genuine rollback-owed journal behind.
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const a = Object.fromEntries(process.argv.slice(2).map((x) => { const [k, ...v] = x.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const WORK = a.work, DIST = a.dist, SP = a.sp, FILES = Number(a.files || 200), KB = Number(a.kb || 100);
await fsp.rm(WORK, { recursive: true, force: true });
const extensionsDir = path.join(WORK, 'extensions'), storeDir = path.join(WORK, 'extension-store');
await fsp.mkdir(extensionsDir, { recursive: true });
const destination = path.join(extensionsDir, 'e2e-lock-probe');
const makeTree = async (root, version) => {
  await fsp.mkdir(path.join(root, 'skills'), { recursive: true });
  await fsp.mkdir(path.join(root, 'payload'), { recursive: true });
  await fsp.writeFile(path.join(root, 'qwen-extension.json'), JSON.stringify({ name: 'e2e-lock-probe', version }));
  await fsp.writeFile(path.join(root, 'skills', 'keep.md'), `keep@${version}`);
  if (version === '1.0.0') await fsp.writeFile(path.join(root, 'dropped-by-v2.md'), 'dropped');
  else { await fsp.mkdir(path.join(root, 'added-dir', 'nested'), { recursive: true }); await fsp.writeFile(path.join(root, 'added-dir', 'nested', 'x.md'), 'added'); }
  const body = Buffer.alloc(KB * 1024, version === '1.0.0' ? 0x31 : 0x32);
  for (let i = 0; i < FILES; i += 1) await fsp.writeFile(path.join(root, 'payload', `f${String(i).padStart(4, '0')}.bin`), body);
};
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
const { ExtensionStore } = await import(path.join(DIST, 'src/extension/extension-store.js'));
const store = new ExtensionStore({ extensionsDir, storeDir, enablementPath: path.join(extensionsDir, 'extension-enablement.json') });
const identity = { id: createHash('sha256').update('e2e-lock-probe').digest('hex'), name: 'e2e-lock-probe' };
const s1 = await store.createStagingDirectory();
await makeTree(s1, '1.0.0');
await store.commitArtifact({ operation: 'install', identity, stagingDirectory: s1, destinationDirectory: destination, initialActivation: { scope: 'user' } });
await makeTree(path.join(WORK, 'v2'), '2.0.0');
const holder = spawn('python3', [path.join(SP, 'lockfs/holder.py'), extensionsDir], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => holder.stdout.once('data', r));
const env = { ...process.env, LD_PRELOAD: path.join(SP, 'lockfs/winlock.so'), WINLOCK_ROOT: extensionsDir };
const child = spawn(process.execPath, [path.join(SP, 'harness/crash-child.mjs'), `--dist=${DIST}`, `--work=${WORK}`], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let out = ''; child.stdout.on('data', (d) => { out += d; });
const td = path.join(storeDir, 'transactions');
let strategy = null, killed = null; const t0 = Date.now();
while (Date.now() - t0 < 20000) {
  for (const n of fs.existsSync(td) ? fs.readdirSync(td).filter((x) => x.endsWith('.json')) : []) { try { strategy = JSON.parse(fs.readFileSync(path.join(td, n), 'utf8')).swapStrategy ?? strategy; } catch {} }
  let c = 0;
  try { for (const f of fs.readdirSync(path.join(destination, 'payload')).slice(0, 40)) { const fd = fs.openSync(path.join(destination, 'payload', f), 'r'); const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, 0); fs.closeSync(fd); if (b[0] === 0x32) c++; } } catch {}
  if (strategy === 'copy' && c >= 5) { child.kill('SIGKILL'); killed = c; break; }
  await new Promise((r) => setTimeout(r, 5));
}
await new Promise((r) => child.once('exit', r));
holder.kill('SIGKILL');
console.log(JSON.stringify({ strategy, killedWithV2Sampled: killed, committed: out.includes('COMMITTED'), top: fs.readdirSync(destination).sort() }));
