/* Scenario D: real tree shapes through the copy-mode swap. */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const { work: WORK, dist: DIST, sp: SP } = args;
const results = [];
const check = (n, ok, d) => { results.push({ n, ok: !!ok }); console.log(`${ok ? '\u001b[32mPASS\u001b[0m' : '\u001b[1;31mFAIL\u001b[0m'}  ${n}${d ? `  \u001b[2m[${d}]\u001b[0m` : ''}`); };
const note = (k, v) => console.log(`\u001b[36mNOTE\u001b[0m  ${k}: \u001b[2m${v}\u001b[0m`);
await fsp.rm(WORK, { recursive: true, force: true });
const extensionsDir = path.join(WORK, 'extensions'), storeDir = path.join(WORK, 'extension-store');
await fsp.mkdir(extensionsDir, { recursive: true });
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
const { ExtensionStore } = await import(path.join(DIST, 'src/extension/extension-store.js'));
const store = new ExtensionStore({ extensionsDir, storeDir, enablementPath: path.join(extensionsDir, 'extension-enablement.json') });
const identity = { id: createHash('sha256').update('shapes').digest('hex'), name: 'shapes' };
const destination = path.join(extensionsDir, 'shapes');

const v1 = await store.createStagingDirectory();
await fsp.mkdir(path.join(v1, 'legacy', 'nested'), { recursive: true });
await fsp.mkdir(path.join(v1, 'bin'), { recursive: true });
await fsp.writeFile(path.join(v1, 'qwen-extension.json'), JSON.stringify({ name: 'shapes', version: '1.0.0' }));
await fsp.writeFile(path.join(v1, 'legacy', 'nested', 'old.md'), 'old');
await fsp.writeFile(path.join(v1, 'legacy', 'top.md'), 'old');
await fsp.writeFile(path.join(v1, 'bin', 'hook.sh'), '#!/bin/sh\necho v1\n', { mode: 0o755 });
await fsp.writeFile(path.join(v1, 'swap'), 'a file in v1, a directory in v2');
await fsp.symlink(path.join('bin', 'hook.sh'), path.join(v1, 'link-to-hook'));
await store.commitArtifact({ operation: 'install', identity, stagingDirectory: v1, destinationDirectory: destination, initialActivation: { scope: 'user' } });

const holder = spawn('python3', [path.join(SP, 'lockfs/holder.py'), extensionsDir], { stdio: ['ignore', 'pipe', 'inherit'] });
note('holder', (await new Promise((r) => holder.stdout.once('data', (d) => r(String(d).trim())))));

const v2 = await store.createStagingDirectory();
await fsp.mkdir(path.join(v2, 'bin'), { recursive: true });
await fsp.mkdir(path.join(v2, 'swap'), { recursive: true });
await fsp.writeFile(path.join(v2, 'qwen-extension.json'), JSON.stringify({ name: 'shapes', version: '2.0.0' }));
await fsp.writeFile(path.join(v2, 'bin', 'hook.sh'), '#!/bin/sh\necho v2\n', { mode: 0o755 });
await fsp.writeFile(path.join(v2, 'swap', 'inside.md'), 'now a directory');
await fsp.symlink(path.join('bin', 'hook.sh'), path.join(v2, 'link-to-hook'));

let err;
try { await store.commitArtifact({ operation: 'update', identity, stagingDirectory: v2, destinationDirectory: destination }); } catch (e) { err = e; }
note('update', err ? `${err.name}: ${String(err.message).split('\n')[0].slice(0, 140)}` : 'ok');
check('copy-mode update completes', !err);
check('a whole directory the new version drops is pruned', !fs.existsSync(path.join(destination, 'legacy')),
  fs.existsSync(path.join(destination, 'legacy')) ? fs.readdirSync(path.join(destination, 'legacy')).join(',') : 'gone');
const mode = (p) => (fs.statSync(p).mode & 0o777).toString(8);
check('the executable bit survives the copy', mode(path.join(destination, 'bin', 'hook.sh')) === '755', mode(path.join(destination, 'bin', 'hook.sh')));
check('the hook carries v2 content', fs.readFileSync(path.join(destination, 'bin', 'hook.sh'), 'utf8').includes('v2'));
const lst = fs.lstatSync(path.join(destination, 'link-to-hook'));
check('a symlink stays a symlink, target verbatim', lst.isSymbolicLink() && fs.readlinkSync(path.join(destination, 'link-to-hook')) === path.join('bin', 'hook.sh'),
  lst.isSymbolicLink() ? fs.readlinkSync(path.join(destination, 'link-to-hook')) : 'not a link');
const swap = fs.lstatSync(path.join(destination, 'swap'));
check('an entry whose kind changes file -> directory is reconciled', swap.isDirectory() && fs.existsSync(path.join(destination, 'swap', 'inside.md')), swap.isDirectory() ? 'directory' : 'still a file');
check('manifest is v2', JSON.parse(fs.readFileSync(path.join(destination, 'qwen-extension.json'), 'utf8')).version === '2.0.0');
const leftover = fs.readdirSync(path.join(storeDir, 'transactions')).filter((n) => n.endsWith('.json'));
check('no journal left behind', leftover.length === 0, leftover.join(','));
holder.kill('SIGKILL');
const f = results.filter((r) => !r.ok);
console.log(`\n\u001b[1m RESULT: ${f.length === 0 ? '\u001b[42;30m PASS ' : '\u001b[41;37m FAIL '}\u001b[0m\u001b[1m  (${results.length - f.length}/${results.length} checks)\u001b[0m`);
