/*
 * Scenario E: a file inside the installed tree that can never be replaced or
 * deleted (a real, permanent EPERM - chattr +i, the closest POSIX analogue of a
 * Windows file another process holds against deletion), hit WHILE the directory
 * rename is refused. This drives the apply copy into a real failure and then the
 * copy-mode rollback into a real failure, with no mocks anywhere.
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const { work: WORK, dist: DIST, sp: SP } = args;
const results = [];
const check = (n, ok, d) => { results.push({ n, ok: !!ok }); console.log(`${ok ? '\u001b[32mPASS\u001b[0m' : '\u001b[1;31mFAIL\u001b[0m'}  ${n}${d ? `  \u001b[2m[${d}]\u001b[0m` : ''}`); };
const note = (k, v) => console.log(`\u001b[36mNOTE\u001b[0m  ${k}: \u001b[2m${v}\u001b[0m`);
const immutable = (p, on) => spawnSync('chattr', [on ? '+i' : '-i', p]).status === 0;

await fsp.rm(WORK, { recursive: true, force: true });
const extensionsDir = path.join(WORK, 'extensions'), storeDir = path.join(WORK, 'extension-store');
await fsp.mkdir(extensionsDir, { recursive: true });
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
const { ExtensionStore } = await import(path.join(DIST, 'src/extension/extension-store.js'));
const mkStore = () => new ExtensionStore({ extensionsDir, storeDir, enablementPath: path.join(extensionsDir, 'extension-enablement.json') });
const store = mkStore();
const identity = { id: createHash('sha256').update('pinned').digest('hex'), name: 'pinned' };
const destination = path.join(extensionsDir, 'pinned');

const tree = async (root, v) => {
  await fsp.mkdir(path.join(root, 'skills'), { recursive: true });
  await fsp.writeFile(path.join(root, 'qwen-extension.json'), JSON.stringify({ name: 'pinned', version: v }));
  await fsp.writeFile(path.join(root, 'skills', 'keep.md'), `keep@${v}`);
  await fsp.writeFile(path.join(root, 'pinned.bin'), `pinned@${v}`);
};
const s1 = await store.createStagingDirectory();
await tree(s1, '1.0.0');
await store.commitArtifact({ operation: 'install', identity, stagingDirectory: s1, destinationDirectory: destination, initialActivation: { scope: 'user' } });
const pinnedFile = path.join(destination, 'pinned.bin');
check('the installed file can be made permanently unreplaceable', immutable(pinnedFile, true));
let unlinkCode = '';
try { fs.unlinkSync(pinnedFile); } catch (e) { unlinkCode = `${e.code} ${e.syscall}`; }
check('ground truth: deleting it really fails', unlinkCode.startsWith('EPERM'), unlinkCode);

const holder = spawn('python3', [path.join(SP, 'lockfs/holder.py'), extensionsDir], { stdio: ['ignore', 'pipe', 'inherit'] });
note('holder', (await new Promise((r) => holder.stdout.once('data', (d) => r(String(d).trim())))));

const s2 = await store.createStagingDirectory();
await tree(s2, '2.0.0');
let err;
const t0 = Date.now();
try { await store.commitArtifact({ operation: 'update', identity, stagingDirectory: s2, destinationDirectory: destination }); } catch (e) { err = e; }
note('update', err ? `${err.name} (${err.code ?? '-'}): ${String(err.message).split('\n')[0].slice(0, 190)}` : 'ok (unexpected)');
note('update ms', Date.now() - t0);
check('the update is refused rather than silently half-applied', !!err, err?.name);

const readVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(destination, 'qwen-extension.json'), 'utf8')).version; } catch (e) { return `unreadable(${e.code})`; } };
const state = () => ({
  manifest: readVersion(),
  keep: (() => { try { return fs.readFileSync(path.join(destination, 'skills', 'keep.md'), 'utf8'); } catch (e) { return `ERR ${e.code}`; } })(),
  pinned: (() => { try { return fs.readFileSync(pinnedFile, 'utf8'); } catch (e) { return `ERR ${e.code}`; } })(),
  journals: fs.readdirSync(path.join(storeDir, 'transactions')).filter((n) => n.endsWith('.json')),
  rollback: fs.existsSync(path.join(storeDir, 'rollback')) ? fs.readdirSync(path.join(storeDir, 'rollback')) : [],
});
const afterFail = state();
note('tree after the failed update', JSON.stringify(afterFail));
const journalBody = afterFail.journals[0] ? JSON.parse(fs.readFileSync(path.join(storeDir, 'transactions', afterFail.journals[0]), 'utf8')) : null;
note('journal', journalBody ? JSON.stringify({ phase: journalBody.phase, swapStrategy: journalBody.swapStrategy, rollbackBlocked: journalBody.rollbackBlocked, cleanupPending: journalBody.cleanupPending, retryInMs: journalBody.rollbackRetryAt ? journalBody.rollbackRetryAt - Date.now() : undefined }) : 'none');
check('the tree a reader now sees is internally consistent',
  (afterFail.manifest === '1.0.0' && afterFail.keep === 'keep@1.0.0' && afterFail.pinned === 'pinned@1.0.0') ||
  (afterFail.manifest === '2.0.0' && afterFail.keep === 'keep@2.0.0' && afterFail.pinned === 'pinned@2.0.0'),
  `${afterFail.manifest} / ${afterFail.keep} / ${afterFail.pinned}`);

// what the next operation does while the obstruction is still in place
let second;
try {
  const s3 = await mkStore().createStagingDirectory();
  await tree(s3, '3.0.0');
  await mkStore().commitArtifact({ operation: 'update', identity, stagingDirectory: s3, destinationDirectory: destination });
} catch (e) { second = e; }
note('next update while still obstructed', second ? `${second.name} (${second.code ?? '-'}): ${String(second.message).split('\n')[0].slice(0, 170)}` : 'succeeded');
let readOk = false;
try { const snap = await mkStore().readSnapshot(); readOk = !!snap; } catch (e) { note('read while obstructed', `${e.name}: ${String(e.message).slice(0, 120)}`); }
note('reads while obstructed', readOk ? 'still served' : 'refused');

// the obstruction goes away, exactly as a holder letting go
immutable(pinnedFile, false);
note('obstruction removed', 'chattr -i');
let healed, healErr;
try { const snap = await mkStore().readSnapshot(); healed = snap.generation; } catch (e) { healErr = e; }
note('read immediately after release', healErr ? `${healErr.name}: ${String(healErr.message).slice(0, 120)}` : `generation=${healed}`);
const insideWindow = state();
check('inside the retry window the owed rollback is deferred, not retried on a read',
  insideWindow.journals.length === 1, JSON.stringify(insideWindow.journals));
// the persisted window is 5s; a read past it must heal the tree with no mutation
await new Promise((r) => setTimeout(r, 6000));
try { const snap = await mkStore().readSnapshot(); healed = snap.generation; } catch (e) { healErr = e; }
note('read after the retry window', healErr ? `${healErr.name}: ${String(healErr.message).slice(0, 120)}` : `generation=${healed}`);
const afterHeal = state();
note('tree after release', JSON.stringify(afterHeal));
check('the store heals itself once the obstruction is gone', afterHeal.journals.length === 0 && afterHeal.rollback.length === 0, JSON.stringify({ journals: afterHeal.journals, rollback: afterHeal.rollback }));
check('the healed tree is consistent', afterHeal.manifest === '1.0.0' && afterHeal.keep === 'keep@1.0.0' && afterHeal.pinned === 'pinned@1.0.0', `${afterHeal.manifest} / ${afterHeal.keep} / ${afterHeal.pinned}`);
let finalErr;
try {
  const s4 = await mkStore().createStagingDirectory();
  await tree(s4, '4.0.0');
  await mkStore().commitArtifact({ operation: 'update', identity, stagingDirectory: s4, destinationDirectory: destination });
} catch (e) { finalErr = e; }
note('update after release', finalErr ? `${finalErr.name}: ${String(finalErr.message).split('\n')[0].slice(0, 140)}` : 'ok');
check('a later update succeeds again', !finalErr, finalErr?.name);
check('it really landed 4.0.0', readVersion() === '4.0.0', readVersion());
holder.kill('SIGKILL');
immutable(pinnedFile, false);
const f = results.filter((r) => !r.ok);
console.log(`\n\u001b[1m RESULT: ${f.length === 0 ? '\u001b[42;30m PASS ' : '\u001b[41;37m FAIL '}\u001b[0m\u001b[1m  (${results.length - f.length}/${results.length} checks)\u001b[0m`);
