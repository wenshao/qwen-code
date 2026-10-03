// Performs ONLY the copy-mode update, so the driver can kill it mid-copy.
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
const { ExtensionStore } = await import(path.join(args.dist, 'src/extension/extension-store.js'));
const extensionsDir = path.join(args.work, 'extensions');
const storeDir = path.join(args.work, 'extension-store');
const store = new ExtensionStore({ extensionsDir, storeDir, enablementPath: path.join(extensionsDir, 'extension-enablement.json') });
const identity = { id: createHash('sha256').update('e2e-lock-probe').digest('hex'), name: 'e2e-lock-probe' };
const destination = path.join(extensionsDir, 'e2e-lock-probe');
const staging = await store.createStagingDirectory();
await fsp.cp(path.join(args.work, 'v2'), staging, { recursive: true, force: true });
process.stdout.write('STAGED\n');
await store.commitArtifact({ operation: 'update', identity, stagingDirectory: staging, destinationDirectory: destination });
process.stdout.write('COMMITTED\n');
