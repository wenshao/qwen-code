// PR #13243 Windows probe: what a raw absolute path does to import() outside vitest's transform.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(path.join(tmpdir(), 'p13243-'));
const modulePath = path.join(dir, 'handler.mjs');
writeFileSync(modulePath, 'export const ok = 1;\n');
const out = { probe: 'plain-node-import', platform: process.platform, node: process.version, modulePath };
for (const [key, specifier] of [['raw', modulePath], ['fileUrl', pathToFileURL(modulePath).href]]) {
  try {
    const m = await import(specifier);
    out[key] = m.ok === 1 ? 'ok' : 'wrong-module';
  } catch (error) {
    out[key] = error?.code ?? String(error);
  }
}
console.log('PROBE_JSON ' + JSON.stringify(out));
