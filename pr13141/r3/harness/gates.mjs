// Scripted gates for PR #13141 round 3, so every number in the report comes
// from a check that ran rather than from shell output I read.
//
// Re-reads the artifacts the other harnesses produced, and adds the
// environment/isolation/lint/merge checks that were run ad hoc.
//
// Usage: node gates.mjs <artifactDir> <rigDir> <out.json>
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const [art, rig, outFile] = process.argv.slice(2);
if (!art || !rig || !outFile)
  throw new Error('usage: gates.mjs <artifactDir> <rigDir> <out.json>');

const BASE = '47463b79a7dcf1559d03fd06611e39c7a2dec7d5';
const HEAD = '2a702c316d3766a54b302267cbcbfd2e8bb9565c';
const MAIN = 'fb843d6ce70b774c01b0be07b64b0687082785e4';
const REPO = '/Users/wenshao/git/qwen-code-x7';

const results = [];
let pass = 0;
let fail = 0;
function check(id, what, ok, detail) {
  if (ok) pass++;
  else fail++;
  results.push({ id, what, ok: !!ok, detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}  ${what}${ok || !detail ? '' : `\n        ${detail}`}`);
}
const read = (p) => readFileSync(p, 'utf8');
const log = (n) => read(path.join(art, 'logs', n));
const sh = (cwd, cmd, args) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });

console.log('=== isolation: each arm must resolve internal deps inside itself ===');
for (const arm of ['wt-base', 'wt-head', 'wt-merge']) {
  for (const link of ['node_modules/@qwen-code/qwen-code-core', 'packages/cli/node_modules/@qwen-code/qwen-code-core']) {
    const r = sh(path.join(rig, arm), 'readlink', ['-f', link]).stdout.trim();
    check(`ISO/${arm}/${link.split('/').pop()}-${link.startsWith('packages') ? 'cli' : 'root'}`,
      `${arm}: ${link} realpaths inside ${arm}`,
      r === path.join(rig, arm, 'packages/core'), `resolved to ${r}`);
  }
}

console.log('\n=== the arm under test is the arm claimed ===');
for (const [arm, want] of [['wt-base', BASE], ['wt-head', HEAD]]) {
  const got = sh(path.join(rig, arm), 'git', ['rev-parse', 'HEAD']).stdout.trim();
  check(`OID/${arm}`, `${arm} HEAD is ${want.slice(0, 10)}`, got === want, got);
  const dirty = sh(path.join(rig, arm), 'git', ['status', '--porcelain']).stdout
    .split('\n').filter((l) => l && !l.includes('dist-minus-pr'));
  check(`CLEAN/${arm}`, `${arm} working tree clean (mutate.mjs / bundle control restored every file)`,
    dirty.length === 0, dirty.join('\n'));
}

console.log('\n=== effective diff: the PR is two strings plus one test ===');
const stat = sh(REPO, 'git', ['diff', '--stat', `${BASE}..${HEAD}`]).stdout;
check('DIFF/1', 'base..head touches exactly serve.ts and serve.test.ts',
  stat.includes('packages/cli/src/commands/serve.ts') &&
    stat.includes('packages/cli/src/commands/serve.test.ts') &&
    stat.trim().split('\n').length === 3, stat.trim());
check('DIFF/2', 'serve.ts change is 4 lines touched (+2/-2), i.e. only the two description strings',
  /serve\.ts\s+\|\s+4 \+\+--/.test(stat) && /21 insertions\(\+\), 2 deletions\(-\)/.test(stat), stat.trim());
check('DIFF/3', 'the PR touches no web-shell source (so the web-shell asset-hash churn in a base-vs-head bundle diff is main, not this PR)',
  !stat.includes('web-shell'), stat.trim());

console.log('\n=== bundle control: head-minus-PR vs head ===');
const nd = JSON.parse(log('normdist-minus-pr.txt'));
check('BND/1', 'only esbuild.json differs across the whole bundle',
  JSON.stringify(nd.onlyInBase) === '["esbuild.json"]' && JSON.stringify(nd.onlyInPr) === '["esbuild.json"]',
  JSON.stringify({ nd: nd.onlyInBase, pr: nd.onlyInPr }));
check('BND/2', 'exactly the two help strings are the mapped PR contribution', nd.prStringHits === 2, String(nd.prStringHits));
check('BND/3', 'bundle file census matches round 1/2 (1195 files)', nd.baseFiles === 1195, String(nd.baseFiles));
const OLD_URL = 'Reserved Broker URL for --profile hosted-harness; not implemented and rejects startup.';
const NEW_URL = 'Private Broker URL for --profile hosted-harness; required together with token for Workspace tool turns.';
const OLD_TOK = 'Reserved Broker credential for --profile hosted-harness; not implemented and rejects startup.';
const NEW_TOK = 'Private Broker credential for --profile hosted-harness; required together with URL for Workspace tool turns.';
const growth =
  (Buffer.byteLength(NEW_URL) - Buffer.byteLength(OLD_URL)) +
  (Buffer.byteLength(NEW_TOK) - Buffer.byteLength(OLD_TOK));
check('BND/4', 'the two strings together are exactly +32 bytes (URL +17, token +15)', growth === 32, `computed ${growth}`);
// Where those 32 bytes actually land. cli.js does NOT contain the help strings;
// they sit in a code-split chunk, so the chunk is the thing that must grow by
// 32 and cli.js must not grow at all.
const headDist = path.join(rig, 'wt-head/dist');
const ctrlDist = path.join(rig, 'wt-head/dist-minus-pr');
const findChunk = (dir) => {
  const hits = readdirSync(path.join(dir, 'chunks')).filter((f) =>
    readFileSync(path.join(dir, 'chunks', f), 'utf8').includes('Broker URL for --profile hosted-harness'));
  return hits;
};
const hc = findChunk(headDist);
const cc = findChunk(ctrlDist);
check('BND/6', 'exactly one chunk on each side carries the help strings', hc.length === 1 && cc.length === 1,
  `head ${JSON.stringify(hc)}, control ${JSON.stringify(cc)}`);
const dChunk = statSync(path.join(headDist, 'chunks', hc[0])).size - statSync(path.join(ctrlDist, 'chunks', cc[0])).size;
check('BND/7', `that chunk grew by exactly +32 bytes (${cc[0]} -> ${hc[0]})`, dChunk === 32, `delta ${dChunk}`);
check('BND/8', 'cli.js contains no help strings and did not change size',
  !readFileSync(path.join(headDist, 'cli.js'), 'utf8').includes('Broker URL for --profile hosted-harness') &&
    statSync(path.join(headDist, 'cli.js')).size === statSync(path.join(ctrlDist, 'cli.js')).size, '');
const manifestDelta = (() => {
  const a = JSON.parse(readFileSync(path.join(ctrlDist, 'esbuild.json'), 'utf8'));
  const b = JSON.parse(readFileSync(path.join(headDist, 'esbuild.json'), 'utf8'));
  const k = 'packages/cli/src/commands/serve.ts';
  return b.inputs[k].bytes - a.inputs[k].bytes;
})();
check('BND/9', 'esbuild.json reports the same +32 independently, on the serve.ts input side', manifestDelta === 32, `delta ${manifestDelta}`);

console.log('\n=== base-vs-head bundle diff is confounded by the merge, and we say so ===');
const ndRaw = JSON.parse(log('normdist.txt'));
check('BND/5', 'a naive base-vs-head bundle diff shows web-shell churn from the 20 merged main commits, not from this PR',
  ndRaw.onlyInBase.length > 10 && ndRaw.onlyInBase.every((f) => f.startsWith('web-shell/') || f.includes('chunk') || f === 'esbuild.json'),
  `${ndRaw.onlyInBase.length} entries`);

console.log('\n=== trial merge into CURRENT main ===');
const mt = sh(REPO, 'git', ['merge-tree', '--write-tree', '--name-only', MAIN, HEAD]).stdout.trim().split('\n');
check('MRG/1', `head merges into main ${MAIN.slice(0, 10)} with no conflict`, mt.length === 1, mt.join('\n'));
const mstat = sh(path.join(rig, 'wt-merge'), 'git', ['diff', '--stat', `${MAIN}..HEAD`]).stdout;
check('MRG/2', 'merged tree differs from current main by exactly the same two files',
  mstat.trim().split('\n').length === 3 && mstat.includes('serve.ts') && mstat.includes('serve.test.ts'), mstat.trim());
check('MRG/3', 'merged tree carries the corrected text',
  read(path.join(rig, 'wt-merge/packages/cli/src/commands/serve.ts')).split('Private Broker').length - 1 === 2, '');

console.log('\n=== targeted gates ===');
const counts = (t) => {
  const m = t.match(/Test Files\s+(\d+) passed \((\d+)\)/);
  const n = t.match(/Tests\s+(\d+) passed \((\d+)\)/);
  return { files: m ? `${m[1]}/${m[2]}` : '?', tests: n ? `${n[1]}/${n[2]}` : '?' };
};
for (const [arm, file] of [['head', 'unit-related-head.log'], ['merge', 'unit-related-merge.log']]) {
  const t = log(file);
  const c = counts(t);
  check(`GATE/4suites-${arm}`, `${arm}: serve + fast-path + hosted-harness-profile + run-qwen-serve = 709/709, 4/4 files`,
    c.tests === '709/709' && c.files === '4/4' && t.includes('EXIT=0'), JSON.stringify(c));
}
check('GATE/4suites-parity', 'the merged tree scores identically to head (the merge regresses nothing)',
  counts(log('unit-related-head.log')).tests === counts(log('unit-related-merge.log')).tests, '');
// A pty run carries ANSI escapes, so a plain substring match on vitest's
// summary is unreliable — it passed at 40 columns only by accident of where
// the escapes landed. Strip and normalize before comparing.
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const plain = (s) => s.replace(ANSI, '').replace(/\s+/g, ' ');
for (const w of [40, 250]) {
  const s = plain(log(`unit-tty-${w}.summary`));
  check(`GATE/tty${w}`, `serve.test.ts in a real ${w}-column pty: 78/78`,
    s.includes('Tests 78 passed (78)') && s.includes('child_exit=0') && s.includes('exit=0'),
    s.split(' ').slice(0, 12).join(' '));
}
check('GATE/tty-parity', 'the test is width-independent (round 1 finding stays fixed): identical 78/78 at 40 and 250 columns',
  plain(log('unit-tty-40.summary')).includes('Tests 78 passed (78)') &&
    plain(log('unit-tty-250.summary')).includes('Tests 78 passed (78)'), '');

console.log('\n=== lint / format gates, each proven live ===');
const lg = log('lint-gate.txt');
check('LINT/prettier', 'prettier --check clean on both changed files',
  lg.includes('All matched files use Prettier code style!') && lg.includes('prettier exit=0'), '');
check('LINT/prettier-live', 'the prettier gate is live: a planted violation exits non-zero',
  lg.includes('prettier-on-violation exit=1'), '');
const eg = log('eslint-gate.txt');
check('LINT/eslint', 'eslint clean on both changed files', eg.includes('eslint exit=0'), '');
check('LINT/eslint-live', 'the eslint gate is live: planted any + unused vars report 4 errors and exit non-zero',
  eg.includes('4 problems (4 errors') && eg.includes('eslint-on-violation exit=1'), '');

console.log('\n=== carried-forward CI flakes re-measured, and the predicted fix landed ===');
check('FLAKE/latency-head', 'recall-scan-latency passes on head (7/7)',
  log('latency-head.log').includes('Tests  7 passed (7)') && log('latency-head.log').includes('EXIT=0'), '');
check('FLAKE/latency-base', 'recall-scan-latency passes on base (7/7) — an A/A control, so a green head is not luck',
  log('latency-base.log').includes('Tests  7 passed (7)') && log('latency-base.log').includes('EXIT=0'), '');
check('FLAKE/13094', 'the merge picked up #13094, the hosted-lane relaxation round 2 predicted would fix the CI timing gate',
  sh(REPO, 'git', ['log', '--oneline', BASE, '--grep=13094']).stdout.includes('recall scan latency gate'), '');
check('FLAKE/latency-reads-lane', 'the gate now reads RUNNER_ENVIRONMENT to detect a GitHub-hosted lane',
  read(path.join(rig, 'wt-head/packages/core/src/memory/recall-scan-latency.test.ts')).includes("RUNNER_ENVIRONMENT") &&
    read(path.join(rig, 'wt-head/packages/core/src/memory/recall-scan-latency.test.ts')).includes("'github-hosted'"), '');
let wsOk = 0;
for (const i of [1, 2, 3]) {
  const f = path.join(art, 'logs', `wsagents-head-${i}.log`);
  if (existsSync(f) && read(f).includes('Tests  6 passed (6)') && read(f).includes('EXIT=0')) wsOk++;
}
check('FLAKE/wsagents', 'workspace-agents passes 3/3 consecutive full-file runs on head (6/6 each)', wsOk === 3, `${wsOk}/3 green`);

console.log('\n=== issue #13044 acceptance criteria ===');
const readmeHead = read(path.join(rig, 'wt-head/packages/sdk-java/managed-agent-server/README.md'));
const readmeBase = read(path.join(rig, 'wt-base/packages/sdk-java/managed-agent-server/README.md'));
check('AC/1', 'criterion 1: built `qwen serve --help` describes both options and no longer calls them unimplemented',
  JSON.parse(log('ab-help.json')).results.filter((r) => r.id.startsWith('B') && r.ok).length === 7, '');
check('AC/2', 'criterion 2: help, the Managed Agent deployment README and the option consumers agree',
  readmeHead.includes('Configure the') &&
    readmeHead.includes('--managed-runtime-broker-url') &&
    readmeHead.includes('--managed-runtime-broker-token') &&
    !/not implemented|Reserved/i.test(readmeHead.match(/[^.]*managed-runtime-broker[^.]*/)?.[0] ?? 'x'), '');
check('AC/2b', 'the README is byte-identical on base and head — the PR needed no README change, the help text was the outlier',
  readmeHead === readmeBase, '');
check('AC/3', 'criterion 3: no startup, credential or admission behaviour changed (15/15 probe cells identical)',
  (() => { const t = JSON.parse(log('truth.json')); return t.identical === 15 && t.fail === 0; })(), '');

console.log('\n=== sibling options the issue said to leave unchanged ===');
const helpHead = sh(path.join(rig, 'wt-head'), 'node', ['dist/cli.js', 'serve', '--help']).stdout;
const helpBase = sh(path.join(rig, 'wt-base'), 'node', ['dist/cli.js', 'serve', '--help']).stdout;
check('SIB/1', 'all five --experimental-managed-* rows still say "Reserved experimental ... not implemented and rejects startup"',
  (helpHead.match(/Reserved experimental[^\n]*not implemented and rejects startup/g) ?? []).length === 5,
  String((helpHead.match(/Reserved experimental/g) ?? []).length));
check('SIB/2', 'those five rows are byte-identical base vs head',
  (helpBase.match(/--experimental-managed-[^\n]*/g) ?? []).join('\n') ===
    (helpHead.match(/--experimental-managed-[^\n]*/g) ?? []).join('\n'), '');
check('SIB/3', 'no OTHER option row changed between the arms',
  helpBase.split('\n').filter((l) => /^\s+--/.test(l) && !/managed-runtime-broker/.test(l)).join('\n') ===
    helpHead.split('\n').filter((l) => /^\s+--/.test(l) && !/managed-runtime-broker/.test(l)).join('\n'), '');

writeFileSync(outFile, JSON.stringify({ pass, fail, results }, null, 2));
console.log(`\ngates: ${pass} passed, ${fail} failed, ${results.length} assertions`);
process.exit(fail === 0 ? 0 : 1);
