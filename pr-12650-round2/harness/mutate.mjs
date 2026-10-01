// Mutation matrix for PR #12650 @ 0f8f1756: each mutant is one edit to the
// PR's scripts/lint.js, written into the PR worktree, then the PR's own
// scripts/tests/lint.test.js is run. The pristine file is restored from
// /in/lint.pr.js (never via git checkout) after every mutant.
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const IN = '/root/verify/pr12650/r2/in';
const WT = '/root/verify/pr12650/r2/wt';
const OUT = '/root/verify/pr12650/r2/host';
const pristine = readFileSync(`${IN}/lint.pr.js`, 'utf8');
const base = readFileSync(`${IN}/lint.base.js`, 'utf8');

const once = (src, from, to, name) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`${name}: expected 1 match, got ${n}`);
  return src.replace(from, () => to);
};
const block = (src, startMarker, name) => {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`${name}: start marker missing`);
  const end = src.indexOf('\n    `,', start);
  return src.slice(start, end + '\n    `,'.length);
};

// Negative control: the PR file with both lane `run` strings swapped back to
// the merge base's (exports and getLinterPath kept, so the suite can import).
const baseSc = block(base, "        run: `\n      git ls-files | grep -v", 'base sc');
const baseYl = `        run: "git ls-files | grep -E '\\\\.(yaml|yml)' | xargs yamllint --format github",`;
if (!base.includes(baseYl)) throw new Error('base yamllint run not found');
const prSc = block(pristine, "        run: `${stageGitFileList('shellcheck')}", 'pr sc');
const prYl = block(pristine, "        run: `${stageGitFileList('yamllint')}", 'pr yl');

const mutants = [
  ['NC', 'negative control: both lane run strings reverted to merge base',
    (s) => once(once(s, prSc, baseSc, 'nc-sc'), prYl, baseYl, 'nc-yl')],
  ['M1', 'stageGitFileList: drop `|| { echo ...; exit 1; }` git-failure guard',
    (s) => once(s, `files="$(git ls-files)" || { echo "\${label}: git ls-files failed; refusing to lint an empty file list" >&2; exit 1; }`, 'files="$(git ls-files)"', 'M1')],
  ['M2', 'refuseEmptyList: drop `exit 1` (guard only warns)',
    (s) => once(s, 'refusing to pass on an empty file list" >&2\n        exit 1', 'refusing to pass on an empty file list" >&2\n        :', 'M2')],
  ['M3', 'refuseEmptyList: test the literal name, not the variable (`$${variable}` -> `${variable}`)',
    (s) => once(s, 'if [ -z "$${variable}" ]', 'if [ -z "${variable}" ]', 'M3')],
  ['M4', 'refuseEmptyList: `-z` -> `-n` (inverted guard)',
    (s) => once(s, 'if [ -z "$${variable}" ]', 'if [ -n "$${variable}" ]', 'M4')],
  ['M5', 'yamllint: swallow linter status (`| xargs yamllint ...` + `|| true`)',
    (s) => once(s, "xargs yamllint --format github\n", "xargs yamllint --format github || true\n", 'M5')],
  ['M6', 'yamllint: drop `--format github`',
    (s) => once(s, "xargs yamllint --format github\n", "xargs yamllint\n", 'M6')],
  ['M7', 'yamllint: filter only `.yaml` (drop `.yml`)',
    (s) => once(s, "grep -E '\\\\.(yaml|yml)')", "grep -E '\\\\.(yaml)')", 'M7')],
  ['M8', 'shellcheck: drop the awk colon-strip',
    (s) => once(s, " | awk '{ print substr($1, 1, length($1)-1) }'", " | awk '{ print $1 }'", 'M8')],
  ['M9', 'shellcheck: drop the trailing sed severity rewrite',
    (s) => once(s, "--color=never | sed -e 's/note:/warning:/g' -e 's/style:/warning:/g'", '--color=never', 'M9')],
  ['M10', 'shellcheck: drop `--exclude=SC2002,SC2129,SC2310`',
    (s) => once(s, '        --exclude=SC2002,SC2129,SC2310 \\\\\n', '', 'M10')],
  ['M11', 'shellcheck: drop the `grep -v ^integration-tests/terminal-bench/` filter (lint.js:229)',
    (s) => once(s, " | grep -v '^integration-tests/terminal-bench/'", '', 'M11')],
  ['M12', 'shellcheck: drop the extensionless `[^.]+` branch of the candidate regex',
    (s) => once(s, "grep -E '^([^.]+|.*\\\\.(sh|zsh|bash))'", "grep -E '^(.*\\\\.(sh|zsh|bash))'", 'M12')],
  ['M13', 'getLinterPath: pip --user dir moved ahead of the inherited PATH',
    (s) => once(s, 'path = `${path}:${env.HOME}/.local/bin`;', 'path = path.replace(`:${env.PATH}`, `:${env.HOME}/.local/bin:${env.PATH}`);', 'M13')],
  ['M14', 'getLinterPath: `tempDir = TEMP_DIR` default -> `tmpdir()`',
    (s) => once(s, '  tempDir = TEMP_DIR,\n', '  tempDir = tmpdir(),\n', 'M14')],
  ['M15', "getLinterPath: `cwd = process.cwd()` default -> `'/'`",
    (s) => once(s, '  cwd = process.cwd(),\n  tempDir', "  cwd = '/',\n  tempDir", 'M15')],
  ['M16', "getLinterPath: `platform = process.platform` default -> `'darwin'`",
    (s) => once(s, '  platform = process.platform,\n  cwd = process.cwd(),\n  tempDir', "  platform = 'darwin',\n  cwd = process.cwd(),\n  tempDir", 'M16')],
  ['M17', 'getLinterPath: `env = process.env` default -> `{}` (inherited PATH lost)',
    (s) => once(s, '  env = process.env,\n  platform = process.platform,\n  cwd = process.cwd(),\n  tempDir', '  env = {},\n  platform = process.platform,\n  cwd = process.cwd(),\n  tempDir', 'M17')],
  ['M18', 'runCommand: drop `env.PATH = getLinterPath();`',
    (s) => once(s, '    env.PATH = getLinterPath();\n', '', 'M18')],
];

const rows = [];
try {
  for (const [id, desc, fn] of mutants) {
    const src = fn(pristine);
    if (src === pristine) throw new Error(`${id}: no-op mutant`);
    writeFileSync(`${WT}/scripts/lint.js`, src);
    const r = spawnSync('npx', ['vitest', 'run', '--config', './scripts/tests/vitest.config.ts', 'scripts/tests/lint.test.js', '--reporter=json', `--outputFile=${OUT}/mut-${id}.json`], { cwd: WT, encoding: 'utf8', env: { ...process.env, CI: 'true' } });
    const j = JSON.parse(readFileSync(`${OUT}/mut-${id}.json`, 'utf8'));
    const failed = j.testResults.flatMap((f) => f.assertionResults).filter((a) => a.status === 'failed').map((a) => a.title);
    rows.push({ id, desc, status: r.status, passed: j.numPassedTests, failed: j.numFailedTests, killedBy: failed });
    console.log(`${id}\t${failed.length ? 'KILLED' : 'SURVIVED'}\t${j.numPassedTests}/${j.numTotalTests}\t${desc}\n\t${failed.join(' | ')}`);
  }
} finally {
  writeFileSync(`${WT}/scripts/lint.js`, pristine);
}
writeFileSync(`${OUT}/mutation-matrix.json`, JSON.stringify(rows, null, 2));
execSync(`cmp ${WT}/scripts/lint.js ${IN}/lint.pr.js && git -C ${WT} status --porcelain scripts/`, { stdio: 'inherit' });
