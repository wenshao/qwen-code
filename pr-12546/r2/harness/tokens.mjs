import fs from 'node:fs';
import { getEncoding } from '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/cdedebfd-d7b0-43c5-90a2-e78dac0bc8ab/scratchpad/tok/node_modules/js-tiktoken/dist/index.js';
const enc = getEncoding('o200k_base'); const T = (s) => enc.encode(s).length;
const rd = (a, f) => fs.readFileSync(`render/${a}/${f}`, 'utf8');
const rows = [['general (interactive)', 'general.interactive.todo0.cm0.full.md'], ['general (headless)', 'general.headless.todo0.cm0.full.md'], ['general + todo', 'general.interactive.todo1.cm0.full.md'], ['qwen-coder + todo', 'coder.interactive.todo1.cm0.full.md'], ['CodeModeOnly + todo', 'general.interactive.todo1.cm1.full.md']];
for (const [n, f] of rows) { const m = T(rd('main', f)), h = T(rd('merged', f)), x = T(rd('fix', f)); console.log(`${n.padEnd(22)} main ${m}  fad23c5 ${h} (-${m - h})  6dd7d51 ${x} (-${m - x}, ${((m - x) / m * 100).toFixed(2)}%)`); }
// what differs fix vs merged across all 192
const files = fs.readdirSync('render/fix'); let same = 0, changed = 0; const diffs = new Set();
for (const f of files) { const a = rd('merged', f), b = rd('fix', f); if (a === b) { same++; continue; } changed++;
  const al = a.split('\n'), bl = b.split('\n'); const onlyB = bl.filter((l) => !al.includes(l)), onlyA = al.filter((l) => !bl.includes(l));
  diffs.add(JSON.stringify([onlyA.map((l) => l.slice(0, 90)), onlyB.map((l) => l.slice(0, 90)), bl.length - al.length])); }
console.log('fix vs fad23c5 renders: identical', same, 'changed', changed); for (const d of diffs) console.log(d);
const has = (a, s) => files.filter((f) => rd(a, f).includes(s)).length;
console.log('"did not run a verification step" main/fad/6dd:', has('main', 'did not run a verification step'), has('merged', 'did not run a verification step'), has('fix', 'did not run a verification step'));
console.log('blank line before system-reminder bullet (main/fad/6dd):', ...['main', 'merged', 'fix'].map((a) => has(a, 'as done.\n\n- Tool results and user messages')));
console.log('renders with SE workflow section:', has('fix', '## Software Engineering Tasks'));
