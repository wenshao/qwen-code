// VERIFICATION RIG ONLY (PR #13174 round 3): print what the woken former Harness did, then run the PR's assertions unchanged.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [src, dst] = process.argv.slice(2);
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'snips-wake');
let s = readFileSync(src, 'utf8');
const anchor = '        await new Promise((resolve) => setTimeout(resolve, 5_000));\n        const headAfterWake = runMysql(\n';
const n = s.split(anchor).length - 1;
if (n !== 1) throw new Error(`anchor found ${n}x`);
s = s.split(anchor).join(readFileSync(path.join(dir, 'a.ts'), 'utf8'));
writeFileSync(dst, s);
console.log('probe written', dst);
