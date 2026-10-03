// Rebuild a COPY of a real memory store with one arm's compiled indexer and
// check every emitted link target. Prints counts only, never note content.
import * as fs from 'node:fs';
import * as path from 'node:path';
const [arm, src] = process.argv.slice(2);
const base = `/root/verify/pr13156/realstore/copy-${arm}`;
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
fs.cpSync(src, path.join(base, 'memories'), { recursive: true, preserveTimestamps: true });
process.env.QWEN_CODE_MEMORY_BASE_DIR = base;
const { rebuildUserAutoMemoryIndex } = await import(`/root/verify/pr13156/${arm}/packages/core/dist/src/memory/indexer.js`);
const out = await rebuildUserAutoMemoryIndex();
const lines = out.split('\n').filter((l) => l.startsWith('- ['));
let broken = 0, over = 0;
for (const l of lines) {
  const o = l.indexOf(']('), c = l.indexOf(')', o + 2);
  if (l.length > 150) over++;
  if (c < 0) { broken++; continue; }
  let t = l.slice(o + 2, c);
  try { t = decodeURIComponent(t); } catch { broken++; continue; }
  if (!fs.existsSync(path.join(base, 'memories', t))) broken++;
}
console.log(JSON.stringify({ arm, lines: lines.length, broken, over150: over }));
