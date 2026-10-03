/*
 * Real-lock E2E for PR #11889.
 *
 * Drives the REAL ExtensionStore from a built core dist against a REAL
 * filesystem. The Windows "cannot rename a directory while a process holds an
 * open handle to it or a descendant" rule is reproduced by a live holder
 * process plus an LD_PRELOAD interposer that evaluates that predicate against
 * real /proc state and makes the rename(2) syscall fail with a genuine EPERM.
 * Nothing about the store or node's fs layer is mocked.
 */
import * as fsp from 'node:fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const DIST = args.dist;
const WORK = args.work;
const PLATFORM = args.platform || 'linux';
const LOCK = args.lock === 'on';
const HOLDER = args.holder || '/tmp/holder.py';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: String(detail ?? '') });
  console.log(`${ok ? '\u001b[32mPASS\u001b[0m' : '\u001b[1;31mFAIL\u001b[0m'}  ${name}${detail ? `  \u001b[2m[${detail}]\u001b[0m` : ''}`);
};
const note = (k, v) => console.log(`\u001b[36mNOTE\u001b[0m  ${k}: \u001b[2m${v}\u001b[0m`);

await fsp.rm(WORK, { recursive: true, force: true });
const extensionsDir = path.join(WORK, 'extensions');
const storeDir = path.join(WORK, 'extension-store');
await fsp.mkdir(extensionsDir, { recursive: true });
await fsp.mkdir(storeDir, { recursive: true });

const { ExtensionStore } = await import(
  path.join(DIST, 'src/extension/extension-store.js')
);

if (PLATFORM === 'win32') {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
}
note('process.platform', process.platform);
note('dist', DIST);

const store = new ExtensionStore({
  extensionsDir,
  storeDir,
  enablementPath: path.join(extensionsDir, 'extension-enablement.json'),
});
const identity = {
  id: createHash('sha256').update('e2e-lock-probe').digest('hex'),
  name: 'e2e-lock-probe',
};
const destination = path.join(extensionsDir, 'e2e-lock-probe');

const writeTree = async (root, version, extra) => {
  await fsp.mkdir(path.join(root, 'skills'), { recursive: true });
  await fsp.writeFile(
    path.join(root, 'qwen-extension.json'),
    JSON.stringify({ name: 'e2e-lock-probe', version }, null, 2),
  );
  await fsp.writeFile(path.join(root, 'skills', 'keep.md'), `keep@${version}`);
  if (extra) await fsp.writeFile(path.join(root, extra), `extra@${version}`);
};

// ---------------------------------------------------------------- install v1
const staging1 = await store.createStagingDirectory();
await writeTree(staging1, '1.0.0', 'dropped-by-v2.md');
await store.commitArtifact({
  operation: 'install',
  identity,
  stagingDirectory: staging1,
  destinationDirectory: destination,
  initialActivation: { scope: 'user' },
});
const installedVersion = () =>
  JSON.parse(fs.readFileSync(path.join(destination, 'qwen-extension.json'), 'utf8')).version;
check('install v1 lands 1.0.0', installedVersion() === '1.0.0', installedVersion());

// ------------------------------------------------------------- hold handles
let holder;
if (LOCK) {
  holder = spawn('python3', [HOLDER, extensionsDir], { stdio: ['ignore', 'pipe', 'inherit'] });
  const line = await new Promise((r) => holder.stdout.once('data', (d) => r(String(d).trim())));
  note('holder', `${line} (pid ${holder.pid})`);
  // Ground truth: the same rename the store is about to attempt really fails.
  const probeFrom = destination;
  const probeTo = path.join(extensionsDir, '.rename-probe');
  let probe = 'renamed (NOT locked)';
  try {
    fs.renameSync(probeFrom, probeTo);
    fs.renameSync(probeTo, probeFrom);
  } catch (e) {
    probe = `${e.code} ${e.syscall}`;
  }
  check('ground truth: directory rename is refused', probe.startsWith('EPERM'), probe);
}

// ----------------------------------------------------------------- update v2
// Strategy oracle: the rename path replaces the destination directory (new
// inode); the copy path writes into the one that is already there.
const inodeBefore = fs.statSync(destination).ino;
const staging2 = await store.createStagingDirectory();
await writeTree(staging2, '2.0.0', 'added-by-v2.md');
let updateError;
const t0 = Date.now();
try {
  await store.commitArtifact({
    operation: 'update',
    identity,
    stagingDirectory: staging2,
    destinationDirectory: destination,
  });
} catch (e) {
  updateError = e;
}
const updateMs = Date.now() - t0;
let inodeAfter = -1;
try { inodeAfter = fs.statSync(destination).ino; } catch { /* gone */ }
const strategy = updateError
  ? 'n/a (update failed)'
  : inodeAfter === -1
    ? 'none'
    : inodeAfter === inodeBefore
      ? 'copy (destination inode unchanged)'
      : 'rename (destination inode replaced)';
note('swap strategy', `${strategy}  ino ${inodeBefore} -> ${inodeAfter}`);
note('update', updateError ? `${updateError.name}: ${String(updateError.message).split('\n')[0].slice(0, 160)}` : 'ok');
note('update ms', updateMs);
check('update completes', !updateError, updateError ? updateError.code || updateError.name : 'no error');
let version = 'MISSING';
try { version = installedVersion(); } catch { /* gone */ }
check('installed tree is 2.0.0', version === '2.0.0', version);
check('file dropped by v2 is pruned', !fs.existsSync(path.join(destination, 'dropped-by-v2.md')),
  fs.existsSync(path.join(destination, 'dropped-by-v2.md')) ? 'still present' : 'pruned');
check('file added by v2 is present', fs.existsSync(path.join(destination, 'added-by-v2.md')));
let keep = '';
try { keep = fs.readFileSync(path.join(destination, 'skills', 'keep.md'), 'utf8'); } catch { keep = 'MISSING'; }
check('nested file carries v2 content', keep === 'keep@2.0.0', keep);

const listDir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const afterUpdate = {
  transactions: listDir(path.join(storeDir, 'transactions')).filter((n) => n.endsWith('.json')),
  rollback: listDir(path.join(storeDir, 'rollback')),
  staging: listDir(path.join(storeDir, 'staging')),
};
note('store areas after update', JSON.stringify(afterUpdate));
check('no journal left after update', afterUpdate.transactions.length === 0, afterUpdate.transactions.join(','));
check('rollback area empty after update', afterUpdate.rollback.length === 0, afterUpdate.rollback.join(','));

// reads still work through the store while the holder keeps holding
let snapshotOk = false, snapGen = -1;
try {
  const snap = await store.readSnapshot();
  snapGen = snap.generation;
  snapshotOk = !!snap.extensions[identity.id];
} catch (e) { note('readSnapshot error', e.message.slice(0, 120)); }
check('store snapshot still readable and carries the extension', snapshotOk, `generation=${snapGen}`);

// ------------------------------------------------------------------ uninstall
let uninstallError;
try {
  await store.commitArtifact({ operation: 'uninstall', identity, destinationDirectory: destination });
} catch (e) { uninstallError = e; }
note('uninstall', uninstallError ? `${uninstallError.name}: ${String(uninstallError.message).split('\n')[0].slice(0, 160)}` : 'ok');
check('uninstall completes', !uninstallError, uninstallError ? uninstallError.code || uninstallError.name : 'no error');
check('installed directory is gone', !fs.existsSync(destination), fs.existsSync(destination) ? listDir(destination).join(',') || '(empty dir)' : 'gone');
let entryGone = false;
try {
  const snap = await store.readSnapshot();
  entryGone = !snap.extensions[identity.id];
} catch (e) { note('readSnapshot(uninstall) error', e.message.slice(0, 120)); }
check('store entry removed', entryGone);
const afterUninstall = {
  transactions: listDir(path.join(storeDir, 'transactions')).filter((n) => n.endsWith('.json')),
  rollback: listDir(path.join(storeDir, 'rollback')),
};
note('store areas after uninstall', JSON.stringify(afterUninstall));
check('no residue in store areas', afterUninstall.transactions.length === 0 && afterUninstall.rollback.length === 0,
  JSON.stringify(afterUninstall));

if (holder) holder.kill('SIGKILL');
const failed = results.filter((r) => !r.ok);
console.log(`\n\u001b[1m RESULT: ${failed.length === 0 ? '\u001b[42;30m PASS ' : '\u001b[41;37m FAIL '}\u001b[0m\u001b[1m  (${results.length - failed.length}/${results.length} checks)\u001b[0m`);
if (args.json) await fsp.writeFile(args.json, JSON.stringify({ arm: args.arm || '', platform: PLATFORM, lock: LOCK, results }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
