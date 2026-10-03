// Scope of the version/help intercept, and what a dash-leading answer can
// do. No supervisor in this home, so a command that is REACHED answers
// "Cannot reach the Agent View supervisor" (exit 1); one that is not
// reached prints a version, or a usage error.
//   node r10-06-version-scope.mjs head
import path from 'node:path';
import { freshDir, out, ROOT } from './lib.mjs';
import { bin } from './e2e-lib.mjs';

const arm = process.argv[2] ?? 'head';
const dir = freshDir('version-scope', arm);
const home = path.join(dir, 'home');
const cases = [
  ['sessions', 'list', '-v'],
  ['mcp', 'remove', 'some-server', '-v'],
  ['sessions', 'answer', 'abc', 'yes'],
  ['sessions', 'answer', 'abc', '-y is fine'],
  ['sessions', 'answer', 'abc', '--', '-y is fine'],
  ['sessions', 'answer', 'abc', '--', '-v'],
  ['sessions', 'stop', 'abc', '--', '-v'],
];
const rows = [];
for (const c of cases) {
  const r = bin(arm, home, dir, c, 60_000);
  const text = `${r.stdout}\n${r.stderr}`;
  const verdict = /Cannot reach the Agent View supervisor/.test(text)
    ? 'reached the command'
    : /^\d+\.\d+\.\d+\s*$/.test(r.stdout.trim())
      ? `version ${r.stdout.trim()}`
      : (text.match(/Not enough non-option arguments[^\n]*|Unknown argument[^\n]*/)?.[0] ?? text.trim().split('\n')[0]);
  rows.push({ argv: `qwen ${c.map((t) => (t.includes(' ') ? `"${t}"` : t)).join(' ')}`, code: r.code, verdict });
  console.log(JSON.stringify(rows.at(-1)));
}
out(`${ROOT}/run/version-scope/${arm}.json`, rows);
