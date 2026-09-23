// One store operation in its own process (so LD_PRELOAD applies), printing a
// JSON line: outcome + what a reader of the destination sees right after it.
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
const a = Object.fromEntries(process.argv.slice(2).map((x) => { const [k, ...v] = x.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
const { ExtensionStore } = await import(path.join(a.dist, 'src/extension/extension-store.js'));
const extensionsDir = path.join(a.work, 'extensions'), storeDir = path.join(a.work, 'extension-store');
const store = new ExtensionStore({ extensionsDir, storeDir, enablementPath: path.join(extensionsDir, 'extension-enablement.json') });
const identity = { id: createHash('sha256').update('e2e-lock-probe').digest('hex'), name: 'e2e-lock-probe' };
const destination = path.join(extensionsDir, 'e2e-lock-probe');
const out = { op: a.op };
const t0 = Date.now();
try {
  if (a.op === 'read') out.generation = (await store.readSnapshot()).generation;
  else {
    const staging = await store.createStagingDirectory();
    await fsp.mkdir(path.join(staging, 'skills'), { recursive: true });
    await fsp.writeFile(path.join(staging, 'qwen-extension.json'), JSON.stringify({ name: 'e2e-lock-probe', version: a.version }));
    await fsp.writeFile(path.join(staging, 'skills', 'keep.md'), `keep@${a.version}`);
    await store.commitArtifact({ operation: 'update', identity, stagingDirectory: staging, destinationDirectory: destination });
    out.generation = (await store.readSnapshot()).generation;
  }
  out.ok = true;
} catch (e) { out.ok = false; out.err = `${e.name}${e.code ? ` ${e.code}` : ''}: ${String(e.message).split('\n')[0].slice(0, 150)}`; }
out.ms = Date.now() - t0;
const rd = (p) => { try { return fs.readFileSync(path.join(destination, p), 'utf8'); } catch (e) { return `ERR ${e.code}`; } };
try { out.manifest = JSON.parse(rd('qwen-extension.json')).version; } catch { out.manifest = rd('qwen-extension.json'); }
out.top = fs.existsSync(destination) ? fs.readdirSync(destination).sort() : [];
let v1 = 0, v2 = 0;
try { for (const f of fs.readdirSync(path.join(destination, 'payload'))) { const fd = fs.openSync(path.join(destination, 'payload', f), 'r'); const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, 0); fs.closeSync(fd); if (b[0] === 0x31) v1++; else if (b[0] === 0x32) v2++; } } catch {}
out.payload = `${v1} v1 / ${v2} v2`;
const td = path.join(storeDir, 'transactions');
out.journals = (fs.existsSync(td) ? fs.readdirSync(td) : []).filter((n) => n.endsWith('.json')).map((n) => { try { const j = JSON.parse(fs.readFileSync(path.join(td, n), 'utf8')); return { blocked: j.rollbackBlocked, held: j.rollbackHeld, cleanup: j.cleanupPending, retryInMs: j.rollbackRetryAt ? j.rollbackRetryAt - Date.now() : undefined, orderMs: j.orderMs !== undefined }; } catch { return 'unreadable'; } });
console.log(JSON.stringify(out));
