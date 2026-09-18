/*
 * Scenario B + C for PR #11889.
 *   B: SIGKILL the process in the middle of the copy-mode apply, then let the
 *      next store operation recover, and check what the user is left with.
 *   C: measure the reader-visible window the PR's Risk section discloses.
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const WORK = args.work, DIST = args.dist, SP = args.sp, FILES = Number(args.files || 300), KB = Number(args.kb || 180);
const DO_KILL = args.kill !== 'off';
const DO_READER = args.reader !== 'off';
const STALE_WAIT_MS = Number(args.staleWait || 0);
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: String(detail ?? '') }); console.log(`${ok ? '\u001b[32mPASS\u001b[0m' : '\u001b[1;31mFAIL\u001b[0m'}  ${name}${detail ? `  \u001b[2m[${detail}]\u001b[0m` : ''}`); };
const note = (k, v) => console.log(`\u001b[36mNOTE\u001b[0m  ${k}: \u001b[2m${v}\u001b[0m`);

await fsp.rm(WORK, { recursive: true, force: true });
const extensionsDir = path.join(WORK, 'extensions');
const storeDir = path.join(WORK, 'extension-store');
await fsp.mkdir(extensionsDir, { recursive: true });
const destination = path.join(extensionsDir, 'e2e-lock-probe');

const makeTree = async (root, version, dropped) => {
  await fsp.mkdir(path.join(root, 'skills'), { recursive: true });
  await fsp.mkdir(path.join(root, 'payload'), { recursive: true });
  await fsp.writeFile(path.join(root, 'qwen-extension.json'), JSON.stringify({ name: 'e2e-lock-probe', version }));
  await fsp.writeFile(path.join(root, 'skills', 'keep.md'), `keep@${version}`);
  if (dropped) await fsp.writeFile(path.join(root, 'dropped-by-v2.md'), 'dropped');
  else await fsp.writeFile(path.join(root, 'added-by-v2.md'), 'added');
  const body = Buffer.alloc(KB * 1024, version === '1.0.0' ? 0x31 : 0x32);
  for (let i = 0; i < FILES; i += 1) await fsp.writeFile(path.join(root, 'payload', `f${String(i).padStart(4, '0')}.bin`), body);
};

Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
const { ExtensionStore } = await import(path.join(DIST, 'src/extension/extension-store.js'));
const store = new ExtensionStore({ extensionsDir, storeDir, enablementPath: path.join(extensionsDir, 'extension-enablement.json') });
const identity = { id: createHash('sha256').update('e2e-lock-probe').digest('hex'), name: 'e2e-lock-probe' };

// install v1 (no lock yet, so this is the ordinary rename path)
const staging1 = await store.createStagingDirectory();
await makeTree(staging1, '1.0.0', true);
await store.commitArtifact({ operation: 'install', identity, stagingDirectory: staging1, destinationDirectory: destination, initialActivation: { scope: 'user' } });
await makeTree(path.join(WORK, 'v2'), '2.0.0', false);
const treeBytes = Number(spawnSync('du', ['-sb', destination]).stdout.toString().split('\t')[0]);
note('installed tree', `${FILES + 3} files, ${(treeBytes / 1048576).toFixed(1)} MB`);

// the holder: one directory handle per subdirectory, as a recursive watcher takes
const holder = spawn('python3', [path.join(SP, 'lockfs/holder.py'), extensionsDir], { stdio: ['ignore', 'pipe', 'inherit'] });
note('holder', (await new Promise((r) => holder.stdout.once('data', (d) => r(String(d).trim())))) + ` (pid ${holder.pid})`);

// concurrent reader, for the disclosed in-place window
const readerOut = path.join(WORK, 'reader.json');
const reader = DO_READER ? spawn(process.execPath, [path.join(SP, 'harness/reader.mjs'), destination, readerOut, String(args.readerMs || 12000)], { stdio: 'inherit' }) : undefined;

// the update, in a child we can kill mid-copy
const env = { ...process.env, LD_PRELOAD: path.join(SP, 'lockfs/winlock.so'), WINLOCK_ROOT: extensionsDir, WINLOCK_LOG: path.join(WORK, 'winlock.log') };
const child = spawn(process.execPath, [path.join(SP, 'harness/crash-child.mjs'), `--dist=${DIST}`, `--work=${WORK}`], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let childOut = '';
child.stdout.on('data', (d) => { childOut += String(d); });

// wait until the copy is demonstrably under way: the journal says 'copy' AND
// the destination has started carrying v2 bytes, then kill without warning.
const transactionsDir = path.join(storeDir, 'transactions');
let killedAt = null, journalStrategy = null;
const started = Date.now();
while (Date.now() - started < 20000) {
  const names = fs.existsSync(transactionsDir) ? fs.readdirSync(transactionsDir).filter((n) => n.endsWith('.json')) : [];
  for (const n of names) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(transactionsDir, n), 'utf8'));
      if (j.swapStrategy) journalStrategy = j.swapStrategy;
    } catch { /* mid-write */ }
  }
  let copied = 0;
  try {
    for (const f of fs.readdirSync(path.join(destination, 'payload')).slice(0, 40)) {
      const fd = fs.openSync(path.join(destination, 'payload', f), 'r'); const b = Buffer.alloc(1);
      fs.readSync(fd, b, 0, 1, 0); fs.closeSync(fd); if (b[0] === 0x32) copied += 1;
    }
  } catch { /* racing */ }
  if (journalStrategy === 'copy' && copied >= 5) {
    if (DO_KILL) { child.kill('SIGKILL'); killedAt = { copiedOf40: copied, ms: Date.now() - started }; }
    break;
  }
  await new Promise((r) => setTimeout(r, 10));
}
note('journal strategy seen while running', journalStrategy);
check('the swap really took the copy path', journalStrategy === 'copy', String(journalStrategy));
if (DO_KILL) {
  note('killed mid-copy', killedAt ? `after ${killedAt.ms}ms, ${killedAt.copiedOf40}/40 sampled payload files already carried v2` : 'NOT KILLED');
  check('process was killed while the copy was in flight', !!killedAt, JSON.stringify(killedAt));
}
const copyStartedAt = Date.now();
await new Promise((r) => child.once('exit', r));
note('child output', JSON.stringify(childOut.trim()));
note('child wall clock after detection', `${Date.now() - copyStartedAt} ms`);
if (DO_KILL) check('child died before it could commit', !childOut.includes('COMMITTED'));
else check('the copy-mode update committed', childOut.includes('COMMITTED'), childOut.trim());
if (!DO_KILL) {
  if (reader) { reader.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 400)); try { note('concurrent reader', fs.readFileSync(readerOut, 'utf8').replace(/\s+/g, ' ')); } catch { note('concurrent reader', 'no samples'); } }
  holder.kill('SIGKILL');
  const f = results.filter((x) => !x.ok);
  console.log(`\n\u001b[1m RESULT: ${f.length === 0 ? '\u001b[42;30m PASS ' : '\u001b[41;37m FAIL '}\u001b[0m\u001b[1m  (${results.length - f.length}/${results.length} checks)\u001b[0m`);
  process.exit(0);
}

// what a reader sees right after the crash, before any recovery
const snapAfterCrash = (() => { try { return JSON.parse(fs.readFileSync(path.join(destination, 'qwen-extension.json'), 'utf8')).version; } catch (e) { return `unreadable(${e.code})`; } })();
const journalsAfterCrash = fs.readdirSync(transactionsDir).filter((n) => n.endsWith('.json'));
note('right after the crash', `manifest=${snapAfterCrash} journals=${journalsAfterCrash.length}`);
check('the interrupted transaction left its journal behind', journalsAfterCrash.length === 1, journalsAfterCrash.join(','));

if (STALE_WAIT_MS > 0) {
  // proper-lockfile keeps the dead process's store lock until it goes stale.
  note('waiting out the store lock left by the killed process', `${STALE_WAIT_MS} ms`);
  await new Promise((r) => setTimeout(r, STALE_WAIT_MS));
}
// ---- recovery: the next store operation, in a fresh process, still locked ----
const rec = spawnSync(process.execPath, ['-e', `
  Object.defineProperty(process,'platform',{value:'win32',configurable:true});
  const path=require('node:path');
  import(path.join(${JSON.stringify(DIST)},'src/extension/extension-store.js')).then(async (m)=>{
    const store=new m.ExtensionStore({extensionsDir:${JSON.stringify(extensionsDir)},storeDir:${JSON.stringify(storeDir)},enablementPath:path.join(${JSON.stringify(extensionsDir)},'extension-enablement.json')});
    try{const s=await store.readSnapshot();console.log('SNAPSHOT_GENERATION',s.generation);}catch(e){console.log('SNAPSHOT_ERROR',e.name,e.code||'',String(e.message).split('\\n')[0].slice(0,140));}
  });
`], { env, encoding: 'utf8' });
note('recovery pass', (rec.stdout || '').trim().replace(/\n/g, ' | ') + (rec.stderr ? ` STDERR:${rec.stderr.trim().slice(0, 200)}` : ''));

const after = (() => { try { return JSON.parse(fs.readFileSync(path.join(destination, 'qwen-extension.json'), 'utf8')).version; } catch (e) { return `unreadable(${e.code})`; } })();
note('manifest after recovery', after);
check('recovery leaves a loadable artifact', after === '1.0.0' || after === '2.0.0', after);
check('recovery restores the committed version (1.0.0)', after === '1.0.0', after);
// every payload file must agree with the manifest - no half-applied tree
let v1 = 0, v2 = 0, missing = 0;
for (let i = 0; i < FILES; i += 1) {
  const p = path.join(destination, 'payload', `f${String(i).padStart(4, '0')}.bin`);
  try { const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, 0); fs.closeSync(fd); b[0] === 0x31 ? v1++ : v2++; } catch { missing += 1; }
}
note('payload after recovery', `v1=${v1} v2=${v2} missing=${missing}`);
check('the recovered tree is internally consistent', (after === '1.0.0' ? v2 === 0 && missing === 0 : v1 === 0 && missing === 0), `v1=${v1} v2=${v2} missing=${missing}`);
check('extra file of the dropped version matches the recovered version', fs.existsSync(path.join(destination, 'dropped-by-v2.md')) === (after === '1.0.0'));
const journalsAfterRecovery = fs.readdirSync(transactionsDir).filter((n) => n.endsWith('.json'));
const rollbackLeft = fs.existsSync(path.join(storeDir, 'rollback')) ? fs.readdirSync(path.join(storeDir, 'rollback')) : [];
note('store areas after recovery', `journals=${journalsAfterRecovery.length} rollback=[${rollbackLeft.join(',')}]`);
check('no journal left after recovery', journalsAfterRecovery.length === 0, journalsAfterRecovery.join(','));
check('no backup left after recovery', rollbackLeft.length === 0, rollbackLeft.join(','));

// a plain update after recovery must still work (store is not wedged)
const staging3 = await store.createStagingDirectory();
await fsp.cp(path.join(WORK, 'v2'), staging3, { recursive: true, force: true });
let reupdate;
try { await store.commitArtifact({ operation: 'update', identity, stagingDirectory: staging3, destinationDirectory: destination }); } catch (e) { reupdate = e; }
note('update after recovery', reupdate ? `${reupdate.name}: ${String(reupdate.message).split('\n')[0].slice(0, 120)}` : 'ok');
check('the store is usable again after recovery', !reupdate, reupdate ? reupdate.code || reupdate.name : 'no error');

if (reader) {
  reader.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  try { note('concurrent reader', JSON.stringify(JSON.parse(fs.readFileSync(readerOut, 'utf8')))); } catch { note('concurrent reader', 'no samples file'); }
}
holder.kill('SIGKILL');
const failed = results.filter((x) => !x.ok);
console.log(`\n\u001b[1m RESULT: ${failed.length === 0 ? '\u001b[42;30m PASS ' : '\u001b[41;37m FAIL '}\u001b[0m\u001b[1m  (${results.length - failed.length}/${results.length} checks)\u001b[0m`);
if (args.json) fs.writeFileSync(args.json, JSON.stringify(results, null, 2));
