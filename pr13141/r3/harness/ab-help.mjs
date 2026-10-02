// A/B load-bearing proof for PR #13141's central claim, on the real built CLI.
//
// The claim: `qwen serve --help` no longer calls the two Broker options
// reserved/unimplemented, and now states their private-Broker purpose. The
// control is the base build (47463b79a7), which differs from the head build by
// exactly the two description strings — established separately by normdist.mjs.
//
// Every cell is an assertion that can fail. Base cells are EXPECTED to carry
// the stale text (that is what makes the change load-bearing), so a base cell
// showing the stale text counts as a PASS, not a failure.
//
// Also asserts the PR did not widen scope: the five sibling
// `--experimental-managed-*` rows, which the linked issue explicitly says to
// leave alone, must be byte-identical on both arms.
//
// Usage: node ab-help.mjs <baseTree> <headTree> <out.json>
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const [baseTree, headTree, outFile] = process.argv.slice(2);
if (!baseTree || !headTree || !outFile)
  throw new Error('usage: ab-help.mjs <baseTree> <headTree> <out.json>');

const OLD_URL =
  'Reserved Broker URL for --profile hosted-harness; not implemented and rejects startup.';
const OLD_TOK =
  'Reserved Broker credential for --profile hosted-harness; not implemented and rejects startup.';
const NEW_URL =
  'Private Broker URL for --profile hosted-harness; required together with token for Workspace tool turns.';
const NEW_TOK =
  'Private Broker credential for --profile hosted-harness; required together with URL for Workspace tool turns.';

const SIBLINGS = [
  'experimental-managed-agents',
  'experimental-managed-runtime-worker',
  'experimental-managed-runtime-auto-local',
  'experimental-managed-runtime-url',
  'experimental-managed-runtime-token',
];

function help(tree, cols) {
  const bin = path.join(tree, 'scripts', 'cli-entry.js');
  const env = { ...process.env, NO_COLOR: '1' };
  // yargs takes the width from process.stdout.columns; when piped there is
  // none and it falls back to its 80-column default. COLUMNS is set for the
  // record, and the real-width cells are driven through a tmux pty by
  // tty-widths.sh instead.
  if (cols) env.COLUMNS = String(cols);
  const r = spawnSync(process.execPath, [bin, 'serve', '--help'], {
    encoding: 'utf8',
    env,
    maxBuffer: 64 << 20,
    cwd: tree,
  });
  if (r.status !== 0)
    throw new Error(`serve --help exited ${r.status} in ${tree}: ${r.stderr}`);
  return r.stdout;
}

// yargs hard-wraps the description column mid-word, so compare with whitespace
// removed — the same normalization the PR's own test uses.
const squash = (s) => s.replace(/\[string\]|\s+/g, '');

const results = [];
let pass = 0;
let fail = 0;
function check(id, what, ok, detail) {
  if (ok) pass++;
  else fail++;
  results.push({ id, what, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}  ${what}${detail && !ok ? `\n        ${detail}` : ''}`);
}

const base = help(baseTree);
const head = help(headTree);
const sb = squash(base);
const sh = squash(head);

console.log('--- base arm (control): the stale text must be present ---');
check('A1', 'base help carries the stale URL text', sb.includes(squash(OLD_URL)), 'OLD_URL not found on base');
check('A2', 'base help carries the stale token text', sb.includes(squash(OLD_TOK)), 'OLD_TOK not found on base');
check('A3', 'base help does NOT carry the new URL text', !sb.includes(squash(NEW_URL)), 'NEW_URL unexpectedly on base');
check('A4', 'base help does NOT carry the new token text', !sb.includes(squash(NEW_TOK)), 'NEW_TOK unexpectedly on base');
check('A5', 'base help does not contain "Private Broker" at all', !sb.includes('PrivateBroker'), '"Private Broker" leaked onto base');

console.log('\n--- head arm: the corrected text must be present ---');
check('B1', 'head help carries the new URL text', sh.includes(squash(NEW_URL)), 'NEW_URL not found on head');
check('B2', 'head help carries the new token text', sh.includes(squash(NEW_TOK)), 'NEW_TOK not found on head');
check('B3', 'head help no longer carries the stale URL text', !sh.includes(squash(OLD_URL)), 'OLD_URL still on head');
check('B4', 'head help no longer carries the stale token text', !sh.includes(squash(OLD_TOK)), 'OLD_TOK still on head');
check('B5', 'head help contains no "not implemented and rejects startup" for the Broker rows',
  !/--managed-runtime-broker-(url|token)[\s\S]{0,200}?notimplementedandrejectsstartup/.test(sh),
  'a Broker row still claims to reject startup');
check('B6', 'both Broker option names are still listed',
  sh.includes('--managed-runtime-broker-url') && sh.includes('--managed-runtime-broker-token'),
  'an option name disappeared from help');
check('B7', 'the [string] type hint survives on both rows',
  (head.match(/--managed-runtime-broker-(?:url|token)[^\n]*\[string\]/g) ?? []).length === 2,
  'type hint lost');

console.log('\n--- scope: the sibling experimental rows must be untouched ---');
// A row runs from its own option line up to (not including) the next line that
// starts a new option. A fixed N-line window spills into the following row,
// which for the last two experimental options is a Broker row that legitimately
// differs between the arms.
const rowOf = (text, name) => {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.includes(`--${name}`));
  if (i === -1) return null;
  let end = i + 1;
  while (end < lines.length && !/^\s*--\S/.test(lines[end])) end++;
  return lines.slice(i, end).join('\n').replace(/\s+/g, ' ').trim();
};
for (const name of SIBLINGS) {
  const b = rowOf(base, name);
  const h = rowOf(head, name);
  check(`C/${name}`, `--${name} row byte-identical base vs head`, b !== null && b === h,
    `base: ${JSON.stringify(b)}\n        head: ${JSON.stringify(h)}`);
  check(`D/${name}`, `--${name} still says "not implemented and rejects startup"`,
    (h ?? '').includes('not implemented and rejects startup'),
    `head row: ${JSON.stringify(h)}`);
}

console.log('\n--- the two arms differ ONLY in the Broker rows ---');
const baseLines = base.split('\n');
const headLines = head.split('\n');
check('E1', 'help line count unchanged', baseLines.length === headLines.length,
  `base ${baseLines.length} lines vs head ${headLines.length}`);
const differing = baseLines
  .map((l, i) => [i, l, headLines[i]])
  .filter(([, b, h]) => b !== h);
check('E2', 'every differing help line mentions a managed-runtime-broker option',
  differing.length > 0 &&
    differing.every(([, b, h]) => /managed-runtime-broker|Private Broker|Reserved Broker|not implemented|required together|hosted-harness/.test(b + h)),
  `differing lines: ${JSON.stringify(differing.map(([, b, h]) => ({ b, h })), null, 2).slice(0, 900)}`);
console.log(`        (${differing.length} differing line(s))`);
for (const [, b, h] of differing) {
  console.log(`        base: ${b.trim()}`);
  console.log(`        head: ${h.trim()}`);
}

writeFileSync(outFile, JSON.stringify({ baseTree, headTree, pass, fail, results }, null, 2));
console.log(`\nhelp A/B: ${pass} passed, ${fail} failed, ${results.length} assertions`);
process.exit(fail === 0 ? 0 : 1);
