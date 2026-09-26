// Classifies every main->merged render diff and checks the PR's structural claims.
import fs from 'node:fs';
import { getEncoding } from '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4cbe8c99-185d-4fbd-8139-88d8a499b5f0/scratchpad/tok/node_modules/js-tiktoken/dist/index.js';
const enc = getEncoding('o200k_base');
const T = (s) => enc.encode(s).length;
const R = '/Users/wenshao/git/v12784/render';
const files = fs.readdirSync(`${R}/main`).sort();
const rd = (a, f) => fs.readFileSync(`${R}/${a}/${f}`, 'utf8');
const label = (l) =>
  l.startsWith('- **Comments:**') ? 'Comments' :
  l.startsWith('- **Plan:**') ? 'Plan' :
  l.startsWith('- **Adapt:**') ? 'Adapt' :
  l.startsWith('- **Task Management:**') ? 'TaskMgmtBullet' : 'OTHER:' + l.slice(0, 60);
const shapes = new Map();
const out = { variants: files.length, identical: 0, shapes: {}, violations: [] };
for (const f of files) {
  const a = rd('main', f), b = rd('merged', f);
  if (a === b) { out.identical++; continue; }
  const al = a.split('\n'), bl = b.split('\n');
  if (al.length !== bl.length) out.violations.push(`${f}: line count ${al.length} -> ${bl.length}`);
  const changed = [];
  for (let i = 0; i < Math.max(al.length, bl.length); i++) if (al[i] !== bl[i]) {
    const la = label(al[i] ?? ''), lb = label(bl[i] ?? '');
    if (la !== lb) out.violations.push(`${f}: line ${i} label ${la} vs ${lb}`);
    changed.push(la);
  }
  const key = changed.join('+');
  shapes.set(key, (shapes.get(key) || 0) + 1);
  // The pointer must never dangle.
  if (b.includes("'# Task Management' governs its use") && !b.includes('\n# Task Management\n'))
    out.violations.push(`${f}: pointer without section`);
  // Each removed rule must survive in the section when todo is on.
  if (f.includes('todo1')) for (const s of [
    'Keep it short and outcome-oriented',
    'Do not use it for simple or single-step queries',
    'Keep the list current, mark finished work completed, and revise it when the scope or approach changes',
    'work that benefits from explicit tracking',
  ]) if (!b.includes(s)) out.violations.push(`${f}: section lost "${s}"`);
}
out.shapes = Object.fromEntries(shapes);
// Gating: which lines the surface drops must be the same set of labels in both arms.
const gateDrops = (a, f) => {
  const full = rd(a, f.replace(/\.(headlessDefault|noShell|shellOnly)\./, '.full.')).split('\n');
  const g = new Set(rd(a, f).split('\n'));
  return full.filter((l) => !g.has(l)).map((l) => l.replace(/^(\s*- \*\*[^*]+\*\*|\s*- To [a-z ]+|\s*- Reserve).*/, '$1')).join('|');
};
let gateSame = 0, gateDiff = [];
for (const f of files.filter((f) => /\.(headlessDefault|noShell|shellOnly)\./.test(f)))
  gateDrops('main', f) === gateDrops('merged', f) ? gateSame++ : gateDiff.push(f);
out.gating = { compared: gateSame + gateDiff.length, sameDroppedLines: gateSame, differ: gateDiff.slice(0, 5) };
// Occurrence counts (todo on, full surface, general interactive).
const f1 = 'general.interactive.todo1.cm0.full.nostyle.md';
const cnt = (s, re) => (s.match(re) || []).length;
out.counts = Object.fromEntries(['main', 'merged'].map((a) => [a, {
  'outcome-oriented': cnt(rd(a, f1), /outcome-oriented/g),
  'simple or single-step': cnt(rd(a, f1), /simple or single-step/g),
  'unless the user explicitly (requests|asks)': cnt(rd(a, f1), /unless the user explicitly (requests|asks)/g),
  "mentions of 'todo_write'": cnt(rd(a, f1), /todo_write/g),
}]));
// Token table, same rows as the PR body (interactive, git cwd, no sandbox/style/context).
const rows = [
  ['general (interactive)', 'general.interactive.todo0.cm0.full.nostyle.md'],
  ['general + todo', 'general.interactive.todo1.cm0.full.nostyle.md'],
  ['qwen-coder + todo', 'coder.interactive.todo1.cm0.full.nostyle.md'],
  ['qwen-vl + todo', 'vl.interactive.todo1.cm0.full.nostyle.md'],
  ['gemma4 + todo', 'gemma4.interactive.todo1.cm0.full.nostyle.md'],
  ['CodeModeOnly + todo', 'general.interactive.todo1.cm1.full.nostyle.md'],
];
out.tokens = rows.map(([n, f]) => {
  const m = T(rd('main', f)), h = T(rd('merged', f));
  return { variant: n, before: m, after: h, delta: h - m, pct: (((m - h) / m) * 100).toFixed(2) + '%', charsBefore: rd('main', f).length, charsAfter: rd('merged', f).length };
});
// Range across all 384 variants.
const deltas = files.map((f) => T(rd('main', f)) - T(rd('merged', f)));
out.tokenDeltaRange = { min: Math.min(...deltas), max: Math.max(...deltas) };
console.log(JSON.stringify(out, null, 1));
