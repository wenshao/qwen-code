import { readdirSync, lstatSync, readlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const debugDir = process.argv[2];
const out = {};
for (const name of readdirSync(debugDir).sort()) {
  const p = join(debugDir, name);
  const st = lstatSync(p);
  out[name] = st.isSymbolicLink()
    ? { type: 'symlink', target: readlinkSync(p), dangling: !existsSync(p) }
    : st.isDirectory() ? { type: 'dir' } : { type: 'file', size: st.size, mtime: st.mtime.toISOString().slice(0,10) };
}
console.log(JSON.stringify(out, null, 2));
