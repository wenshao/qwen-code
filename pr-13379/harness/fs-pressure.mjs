// Peak in-flight async fs ops and peak open fds during ONE full refresh (built core dist).
// usage: node fs-pressure.mjs <arm> <extensionsDir>
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
let inflight = 0, peak = 0, total = 0;
const enter = () => { inflight++; total++; if (inflight > peak) peak = inflight; };
const leave = () => { inflight--; };
for (const name of ['readFile', 'readdir', 'stat', 'lstat', 'access', 'realpath', 'open', 'opendir', 'readlink']) {
  const orig = fsp[name];
  if (typeof orig !== 'function') continue;
  const wrapped = function (...args) { enter(); return orig.apply(this, args).finally(leave); };
  fsp[name] = wrapped; fs.promises[name] = wrapped;
}
for (const name of ['readFile', 'readdir', 'stat', 'lstat', 'access', 'realpath', 'open', 'readlink']) {
  const orig = fs[name];
  const wrapped = function (...args) {
    const cb = args[args.length - 1];
    if (typeof cb !== 'function') return orig.apply(this, args);
    enter(); args[args.length - 1] = function (...r) { leave(); return cb.apply(this, r); };
    return orig.apply(this, args);
  };
  fs[name] = wrapped;
}
syncBuiltinESMExports();
const [arm, extensionsDir] = process.argv.slice(2);
const dist = `/root/verify/pr13379/${arm}/packages/core/dist/src/extension`;
const { ExtensionManager } = await import(`${dist}/extensionManager.js`);
const { ExtensionStore } = await import(`${dist}/extension-store.js`);
const manager = new ExtensionManager({ workspaceDir: extensionsDir, isWorkspaceTrusted: true,
  extensionStore: new ExtensionStore({ extensionsDir, storeDir: path.join(extensionsDir, '..', 'extension-store') }) });
const fdNow = () => fs.readdirSync('/proc/self/fd').length;
const fdBase = fdNow(); let fdPeak = fdBase;
const sampler = setInterval(() => { const n = fdNow(); if (n > fdPeak) fdPeak = n; }, 0);
inflight = 0; peak = 0; total = 0;
await manager.refreshCacheWithSnapshot();
clearInterval(sampler);
const loaded = manager.getLoadedExtensions();
console.log(JSON.stringify({ arm, extensions: loaded.length, skills: loaded.reduce((n, e) => n + (e.skills?.length ?? 0), 0), asyncFsOps: total, peakInflightAsyncFsOps: peak, openFdsBefore: fdBase, peakOpenFdsSampled: fdPeak }));
