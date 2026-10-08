// usage: node spring-ops.mjs <db> [sinceIso] [kindRe] — Spring->Harness automation operations and loads, with answers
import { readFileSync } from 'node:fs';
const [db, since = '1970', kindRe = '.'] = process.argv.slice(2);
const L = readFileSync(`/Users/wenshao/git/pr13598-rig/runs/${db}/tap.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const res = new Map(L.filter((e) => e.dir === 'res').map((e) => [e.id, e]));
for (const e of L.filter((e) => e.dir === 'req' && e.at > since && /operations|\/load|continue/.test(e.url))) {
  const kind = e.auto?.kind ?? (/load/.test(e.url) ? 'load' : /continue/.test(e.url) ? 'continue' : '');
  if (!new RegExp(kindRe).test(kind)) continue;
  const r = res.get(e.id);
  console.log(`${e.at.slice(11, 23)} ${e.url.replace(/\/session\/([0-9a-f]{8})[^/]*/, '/session/$1').padEnd(42)} ${kind.padEnd(13)} ${(e.auto?.occ ?? '').padEnd(32)} -> ${r?.status ?? '?'} ${r?.ms ?? ''}ms`);
}
