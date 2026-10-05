// usage: node variant-refresh.mjs <variant> <extensionsDir>
import path from 'node:path';
import { performance } from 'node:perf_hooks';
const [variant, extensionsDir] = process.argv.slice(2);
const dist = `/root/verify/pr13379/head/packages/core/dist/src/extension`;
const { ExtensionManager } = await import(`${dist}/zzvariant-${variant}.js`);
const { ExtensionStore } = await import(`${dist}/extension-store.js`);
const manager = new ExtensionManager({ workspaceDir: extensionsDir, isWorkspaceTrusted: true,
  extensionStore: new ExtensionStore({ extensionsDir, storeDir: path.join(extensionsDir, '..', 'extension-store') }) });
const t0 = performance.now();
await manager.refreshCacheWithSnapshot();
const ms = performance.now() - t0;
const loaded = manager.getLoadedExtensions();
console.log(JSON.stringify({ variant, ms: +ms.toFixed(1), extensions: loaded.length, skills: loaded.reduce((n, e) => n + (e.skills?.length ?? 0), 0), order: loaded.map((e) => e.name).join(',').length }));
