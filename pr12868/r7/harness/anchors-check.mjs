// Dry check: how often the anchor of every mutant matches in a worktree.
// usage: node anchors-check.mjs <worktree directory name>
import fs from 'node:fs';
import path from 'node:path';
import { mutants as round1, round2, round3, round4, round5 } from './mutants.mjs';
import { round6, reanchored as reanchored6, superseded as superseded6 } from './mutants-r6.mjs';
import { round7, reanchored7, superseded7 } from './mutants-r7.mjs';
let extra = { round7b: [], reanchored7b: {}, superseded7b: new Set() };
try { extra = await import('./mutants-r7b.mjs'); } catch { /* not written yet */ }
const more = await import('./mutants-r7c.mjs');
const last = await import('./mutants-r7d.mjs');
const newest = await import('./mutants-r7e.mjs');
const f7 = await import('./mutants-r7f.mjs');
const reanchored = { ...reanchored6, ...reanchored7, ...extra.reanchored7b, ...more.reanchored7c, ...last.reanchored7d, ...newest.reanchored7e, ...f7.reanchored7f };
const superseded = new Set([...superseded6, ...superseded7, ...extra.superseded7b, ...more.superseded7c, ...last.superseded7d, ...newest.superseded7e, ...f7.superseded7f]);
const all = [...round1, ...round2, ...round3, ...round4, ...round5, ...round6, ...round7, ...extra.round7b, ...more.round7c, ...last.round7d, ...newest.round7e, ...f7.round7f].map((m) => (reanchored[m.id] ? { ...m, ...reanchored[m.id] } : m));
const WT = path.join(path.dirname(path.dirname(new URL(import.meta.url).pathname)), process.argv[2]);
const prefixes = {};
let bad = 0;
for (const m of all) {
  prefixes[m.id.replace(/\d+.*/, '')] = (prefixes[m.id.replace(/\d+.*/, '')] ?? 0) + 1;
  if (superseded.has(m.id)) continue;
  const file = path.join(WT, m.file);
  const hits = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(m.find).length - 1 : -1;
  if (hits !== 1) { bad++; console.log(`${m.id} hits=${hits} suite=${m.suite} file=${path.basename(m.file)} :: ${m.what}`); }
}
console.log(`total=${all.length} superseded=${[...superseded].filter((id) => all.some((m) => m.id === id)).length} anchors that do not match once=${bad} prefixes=${JSON.stringify(prefixes)}`);
