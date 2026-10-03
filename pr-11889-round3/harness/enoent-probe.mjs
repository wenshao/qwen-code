// Is a concurrent reader's file merely MIXED during a copy-mode swap, or can it
// be MISSING? Reads one file in a tight loop while fsp.cp replaces the tree.
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
const work = process.argv[2];
await fsp.rm(work, { recursive: true, force: true });
const src = path.join(work, 'src'), dst = path.join(work, 'dst');
for (const [root, v] of [[src, '2'], [dst, '1']]) {
  await fsp.mkdir(root, { recursive: true });
  for (let i = 0; i < 200; i += 1) await fsp.writeFile(path.join(root, `f${i}.bin`), Buffer.alloc(64 * 1024, v.charCodeAt(0)));
  await fsp.writeFile(path.join(root, 'qwen-extension.json'), JSON.stringify({ version: v === '1' ? '1.0.0' : '2.0.0' }));
}
const reader = spawn(process.execPath, ['-e', `
  const fs=require('fs');const p=${JSON.stringify(path.join(dst, 'qwen-extension.json'))};
  let enoent=0,ok=0,other=0,end=Date.now()+4000;
  while(Date.now()<end){try{fs.readFileSync(p,'utf8');ok++;}catch(e){if(e.code==='ENOENT')enoent++;else other++;}}
  console.log(JSON.stringify({ok,enoent,other}));
`], { stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
reader.stdout.on('data', (d) => { out += d; });
await new Promise((r) => setTimeout(r, 300));
const t0 = Date.now();
await fsp.cp(src, dst, { recursive: true, force: true, preserveTimestamps: true, verbatimSymlinks: true });
console.log(`fsp.cp of 200x64KB took ${Date.now() - t0} ms`);
await new Promise((r) => reader.once('exit', r));
console.log('reader on qwen-extension.json during the copy:', out.trim());
