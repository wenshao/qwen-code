import fs from 'node:fs';
import { getEncoding } from './tok/node_modules/js-tiktoken/dist/index.js';
const enc = getEncoding('o200k_base');
const dir = 'render';
const files = fs.readdirSync(`${dir}/base`).sort();
const T = (s) => enc.encode(s).length;
// token table
const rows = [
  ['general interactive', 'general.interactive.todo0.cm0.full.md'],
  ['general headless', 'general.headless.todo0.cm0.full.md'],
  ['general + todo', 'general.interactive.todo1.cm0.full.md'],
  ['qwen-coder + todo', 'coder.interactive.todo1.cm0.full.md'],
  ['CodeModeOnly + todo', 'general.interactive.todo1.cm1.full.md'],
];
for (const [n, f] of rows) {
  const b = T(fs.readFileSync(`${dir}/base/${f}`, 'utf8')), h = T(fs.readFileSync(`${dir}/head/${f}`, 'utf8'));
  console.log(`${n.padEnd(22)} ${b} -> ${h}  -${b - h} (${((b - h) / b * 100).toFixed(2)}%)`);
}
// section compare
const split = (s) => { const m = new Map(); let k = '(preamble)'; let buf = []; const occ = {};
  for (const l of s.split('\n')) { if (/^#{1,2} /.test(l)) { m.set(k, buf.join('\n')); occ[l] = (occ[l]||0)+1; k = occ[l]>1? `${l}#${occ[l]}`: l; buf = []; } else buf.push(l); }
  m.set(k, buf.join('\n')); return m; };
const changed = {}; let headingDiff = 0, cmp = 0, deltaMin = 1e9, deltaMax = 0;
for (const f of files) {
  const b = fs.readFileSync(`${dir}/base/${f}`, 'utf8'), h = fs.readFileSync(`${dir}/head/${f}`, 'utf8');
  const d = T(b) - T(h); deltaMin = Math.min(deltaMin, d); deltaMax = Math.max(deltaMax, d);
  const sb = split(b), sh = split(h);
  if ([...sb.keys()].join('|') !== [...sh.keys()].join('|')) { headingDiff++; console.log('HEADINGS DIFFER', f); }
  for (const [k, v] of sb) { cmp++; if (sh.get(k) !== v) changed[k] = (changed[k] || 0) + 1; }
}
console.log(`files=${files.length} sectionComparisons=${cmp} headingSetDiffs=${headingDiff} tokenDelta range=${deltaMin}..${deltaMax}`);
console.log('changed sections (count of renders):', changed);
