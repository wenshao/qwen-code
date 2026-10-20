// Mutation sweep over the PR's production code; runs the PR's three test files per mutant.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const WT = '/root/verify/pr14841/wt-head/packages/core';
const P = `${WT}/src/memory/prompt.ts`, B = `${WT}/src/memory/index-budget.ts`;
const M = [
  ['M1 diagnosis never says too-long', P, 'const hasOverlongEntry = entries.some(\n    (line) => line.length > MAX_INDEX_LINE_CHARS,\n  );', 'const hasOverlongEntry = false;'],
  ['M2 diagnosis always says too-long', P, 'const hasOverlongEntry = entries.some(\n    (line) => line.length > MAX_INDEX_LINE_CHARS,\n  );', 'const hasOverlongEntry = true;'],
  ['M3 drop note suppressed', P, "  if (removed.length === 0) {\n    return '';\n  }", "  if (removed.length >= 0) {\n    return '';\n  }"],
  ['M4 early return forgets line-cap drops', B, 'return { content: raw, dropped: overLineCap };', 'return { content: raw, dropped: [] };'],
  ['M5 budget path forgets line-cap drops', B, 'dropped: [...dropped, ...overLineCap],', 'dropped: [...dropped],'],
  ['M6 drop set assumed to be the tail', B, 'dropped: [...dropped, ...overLineCap],', 'dropped: [...entries.slice(surviving.length), ...overLineCap],'],
  ['M7 total omitted from drop note', P, '` Dropped ${removed.length} of ${total} entries: ', '` Dropped ${removed.length} entries: '],
  ['M8 per-line advice unconditional', P, 'const lever = hasOverlongEntry\n', 'const lever = true\n'],
];
const orig = { [P]: fs.readFileSync(P, 'utf8'), [B]: fs.readFileSync(B, 'utf8') };
const rows = [];
try {
  for (const [name, file, from, to] of M) {
    if (!orig[file].includes(from)) { rows.push({ name, status: 'PATTERN-MISSING' }); continue; }
    fs.writeFileSync(file, orig[file].replace(from, to));
    let out = '';
    try {
      out = execFileSync('npx', ['vitest', 'run', 'src/memory/index-budget.test.ts', 'src/memory/prompt.test.ts', 'src/memory/indexer.test.ts'], { cwd: WT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
    } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
    fs.writeFileSync(file, orig[file]);
    const summary = (out.match(/Tests\s+[^\n]+/) || ['?'])[0].replace(/\x1b\[[0-9;]*m/g, '');
    const failed = [...out.matchAll(/(?:FAIL|×|✗)\s+([^\n]+)/g)].map((m) => m[1].replace(/\x1b\[[0-9;]*m/g, '').trim()).slice(0, 6);
    rows.push({ name, status: /failed/.test(summary) ? 'KILLED' : 'SURVIVED', summary, failed });
    console.log(name, '=>', rows.at(-1).status, summary);
  }
} finally {
  fs.writeFileSync(P, orig[P]); fs.writeFileSync(B, orig[B]);
}
fs.writeFileSync('/root/verify/pr14841/mutation.json', JSON.stringify(rows, null, 2));
