// One full refresh in a fresh process, using an arm's BUILT core dist.
// usage: node one-refresh.mjs <arm> <extensionsDir> [mode=full|catalog]
import path from 'node:path';
import { performance } from 'node:perf_hooks';
const [arm, extensionsDir, mode = 'full'] = process.argv.slice(2);
const dist = `/root/verify/pr13379/${arm}/packages/core/dist/src/extension`;
const { ExtensionManager } = await import(`${dist}/extensionManager.js`);
const { ExtensionStore } = await import(`${dist}/extension-store.js`);
const manager = new ExtensionManager({
  workspaceDir: extensionsDir,
  isWorkspaceTrusted: true,
  extensionStore: new ExtensionStore({
    extensionsDir,
    storeDir: path.join(extensionsDir, '..', 'extension-store'),
  }),
});
const t0 = performance.now();
let loaded;
if (mode === 'catalog') loaded = (await manager.refreshCatalogSnapshot()).extensions;
else { await manager.refreshCacheWithSnapshot(); loaded = manager.getLoadedExtensions(); }
const ms = performance.now() - t0;
const skills = loaded.reduce((n, e) => n + (e.skills?.length ?? 0), 0);
console.log(JSON.stringify({ arm, mode, ms: +ms.toFixed(1), extensions: loaded.length, skills }));
