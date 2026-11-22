#!/usr/bin/env node
// Independent A/B harness for PR 18101.
// Extracts the seed-helper preamble from the real workflow files at the base
// and head revisions and drives it under GitHub's default `bash -e`.
// Oracle per cell: exit status, residual maven-cache-seed.?????? files,
// workspace helper survival, and the stub Maven/curl call counts.

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const HEAD_TREE = resolve(process.argv[2]);
const BASE_TREE = resolve(process.argv[3]);
const REAL_HELPER_REL = '.github/scripts/maven-cache-seed.sh';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const SITES = 4;
const assertions = [];
let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  const ok = Boolean(condition);
  assertions.push({ name, ok, detail });
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <-- ${detail}`}`);
}

function stripExpression(text) {
  return text
    .replaceAll('${{ github.repository }}', '${GITHUB_REPOSITORY}')
    .replaceAll('${{ github.sha }}', '${GITHUB_SHA}');
}

// Extract every `repo="${RUNNER_TEMP}/m2-repo"` .. `source "${seed_helper}"`
// preamble from a workflow file, in file order.
function extractPreambles(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*repo="\$\{RUNNER_TEMP\}\/m2-repo"\s*$/.test(lines[i])) continue;
    let end = i;
    while (end < lines.length && !/^\s*source "\$\{seed_helper\}"\s*$/.test(lines[end])) end += 1;
    if (end >= lines.length) throw new Error(`unterminated preamble at line ${i + 1}`);
    const block = lines.slice(i, end + 1);
    const indent = block[0].match(/^\s*/)[0];
    const dedented = block.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line));
    out.push({ startLine: i + 1, text: stripExpression(dedented.join('\n')) });
  }
  return out;
}

// Extract one named step's `run:` block from a workflow file.
function extractStepRun(file, stepName) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const nameIdx = lines.findIndex((line) => line.includes(`- name: '${stepName}'`));
  if (nameIdx < 0) throw new Error(`step not found: ${stepName}`);
  let runIdx = -1;
  for (let i = nameIdx + 1; i < lines.length; i += 1) {
    if (/^\s*run: \|-?\s*$/.test(lines[i])) {
      runIdx = i;
      break;
    }
    if (/^\s*- name:/.test(lines[i])) break;
  }
  if (runIdx < 0) throw new Error(`run block not found for ${stepName}`);
  const runIndent = lines[runIdx].match(/^\s*/)[0] + '  ';
  const block = [];
  for (let i = runIdx + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') {
      block.push('');
      continue;
    }
    if (!lines[i].startsWith(runIndent)) break;
    block.push(lines[i].slice(runIndent.length));
  }
  return stripExpression(block.join('\n'));
}

function makeSandbox({ helperPresent, curlMode, immutableSeed, mountGuardFail = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'pr18101-ab-'));
  const home = join(dir, 'home');
  const runnerTemp = join(dir, 'runner-temp');
  const workspace = join(dir, 'workspace');
  const bin = join(dir, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(runnerTemp, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(workspace, '.github', 'scripts'), { recursive: true });
  if (mountGuardFail) {
    mkdirSync(join(home, '.m2', 'repository'), { recursive: true });
    writeFileSync(join(bin, 'findmnt'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  }
  if (helperPresent) {
    cpSync(join(HEAD_TREE, REAL_HELPER_REL), join(workspace, REAL_HELPER_REL));
  }
  const expectedUrl = `https://raw.githubusercontent.com/QwenLM/qwen-code/${SHA}/${REAL_HELPER_REL}`;
  writeFileSync(
    join(bin, 'curl'),
    `#!/bin/sh
url=''
output=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$url" >> "${runnerTemp}/curl-urls.log"
[ "$url" = '${expectedUrl}' ] || { printf 'unexpected URL: %s\\n' "$url" >&2; exit 64; }
case "$output" in
  "${runnerTemp}"/maven-cache-seed.??????) ;;
  *) printf 'unsafe output: %s\\n' "$output" >&2; exit 65 ;;
esac
[ -f "$output" ] && [ ! -L "$output" ] || { printf 'output is not a fresh regular file\\n' >&2; exit 65; }
if [ "${curlMode}" = '404' ]; then
  printf '404: Not Found\\n' > "$output"
  printf 'stub curl: 404\\n' >&2
  exit 22
fi
if [ "${curlMode}" = 'fail' ]; then
  printf 'stub curl: network failure\\n' >&2
  exit 23
fi
cp '${join(HEAD_TREE, REAL_HELPER_REL)}' "$output"
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, 'mvn'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "${runnerTemp}/mvn-calls.log"
if [ "${immutableSeed ? '1' : '0'}" = '1' ]; then
  for f in "${runnerTemp}"/maven-cache-seed.??????; do
    [ -f "$f" ] || continue
    chattr +i "$f" || { printf 'chattr failed for %s\\n' "$f" >&2; exit 70; }
    printf '%s\\n' "$f" >> "${runnerTemp}/immutable.log"
  done
fi
exit "$MVN_STATUS"
`,
    { mode: 0o755 },
  );
  return { dir, home, runnerTemp, workspace, bin };
}

function runCell({ preamble, helperPresent = false, curlMode = 'ok', mvnStatus = 0, immutableSeed = false, mountGuardFail = false, trapRewrite = null, scriptOverride = null, appendMvn = true }) {
  const sandbox = makeSandbox({ helperPresent, curlMode, immutableSeed, mountGuardFail });
  let body = preamble;
  if (trapRewrite === 'warning') {
    body = body.replace(
      'rm -f -- "${seed_helper}" || true',
      'rm -f -- "${seed_helper}" || echo "::warning::Maven cache seed helper cleanup failed"',
    );
  }
  const script = scriptOverride ?? `${body}${appendMvn ? '\nmvn --batch-mode --no-transfer-progress clean test' : ''}`;
  const env = {
    PATH: `${sandbox.bin}:${process.env.PATH}`,
    HOME: sandbox.home,
    RUNNER_TEMP: sandbox.runnerTemp,
    GITHUB_WORKSPACE: sandbox.workspace,
    GITHUB_SHA: SHA,
    GITHUB_REPOSITORY: 'QwenLM/qwen-code',
    RUNNER_ENVIRONMENT: 'self-hosted',
    MVN_STATUS: String(mvnStatus),
    LC_ALL: 'C',
  };
  const result = spawnSync('bash', ['-e', '-c', script], { encoding: 'utf8', timeout: 30000, env });

  // Undo the immutable attribute so the scratch tree can be removed.
  const immutableLog = join(sandbox.runnerTemp, 'immutable.log');
  if (existsSync(immutableLog)) {
    for (const file of readFileSync(immutableLog, 'utf8').split('\n').filter(Boolean)) {
      spawnSync('chattr', ['-i', file]);
    }
  }
  const residual = readdirSync(sandbox.runnerTemp).filter((name) => /^maven-cache-seed\..{6}$/.test(name));
  const workspaceHelper = join(sandbox.workspace, REAL_HELPER_REL);
  const curlLog = join(sandbox.runnerTemp, 'curl-urls.log');
  const mvnLog = join(sandbox.runnerTemp, 'mvn-calls.log');
  const cell = {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    residual: residual.length,
    residualNames: residual,
    workspaceHelperPresent: existsSync(workspaceHelper),
    curlCalls: existsSync(curlLog) ? readFileSync(curlLog, 'utf8').trim().split('\n').length : 0,
    mvnCalls: existsSync(mvnLog) ? readFileSync(mvnLog, 'utf8').trim().split('\n').length : 0,
    sandbox,
  };
  return cell;
}

function cleanup(cell) {
  rmSync(cell.sandbox.dir, { recursive: true, force: true });
}

const headWorkflow = join(HEAD_TREE, '.github/workflows/sdk-java.yml');
const baseWorkflow = join(BASE_TREE, '.github/workflows/sdk-java.yml');
const headPreambles = extractPreambles(headWorkflow);
const basePreambles = extractPreambles(baseWorkflow);

console.log('== extraction ==');
check('head has exactly 4 sdk-java seed preambles', headPreambles.length === SITES, `got ${headPreambles.length}`);
check('base has exactly 4 sdk-java seed preambles', basePreambles.length === SITES, `got ${basePreambles.length}`);
check(
  'all four head preambles are byte-identical (one hunk applied 4x)',
  new Set(headPreambles.map((p) => p.text)).size === 1,
  `distinct=${new Set(headPreambles.map((p) => p.text)).size}`,
);
check('base preamble installs no EXIT trap', !basePreambles[0].text.includes('trap '), basePreambles[0].text.split('\n').filter((l) => l.includes('trap ')).join('|'));
check(
  'head preamble installs exactly one EXIT trap',
  (headPreambles[0].text.match(/^\s*trap .*EXIT\s*$/gm) ?? []).length === 1,
  `count=${(headPreambles[0].text.match(/^\s*trap .*EXIT\s*$/gm) ?? []).length}`,
);

console.log('\n== A/B: legacy-ref download leaves a temp helper (all 4 sites) ==');
const abRows = [];
for (let i = 0; i < SITES; i += 1) {
  const base = runCell({ preamble: basePreambles[i].text });
  const head = runCell({ preamble: headPreambles[i].text });
  abRows.push({ site: i + 1, headLine: headPreambles[i].startLine, base, head });
  check(`site ${i + 1} base: Maven ran and a temp helper is LEFT BEHIND`, base.status === 0 && base.mvnCalls === 1 && base.residual === 1, `status=${base.status} mvn=${base.mvnCalls} residual=${base.residual}`);
  check(`site ${i + 1} head: Maven ran and NO temp helper remains`, head.status === 0 && head.mvnCalls === 1 && head.residual === 0, `status=${head.status} mvn=${head.mvnCalls} residual=${head.residual}`);
  check(`site ${i + 1} head: the workspace helper was not created/deleted`, head.workspaceHelperPresent === false, `present=${head.workspaceHelperPresent}`);
  cleanup(base);
  cleanup(head);
}

console.log('\n== head: failure and workspace-helper cells (site 1) ==');
const headP = headPreambles[0].text;
const baseP = basePreambles[0].text;

{
  const cell = runCell({ preamble: headP, curlMode: '404' });
  check('head fetch 404: step fails 1 before Maven, no temp file', cell.status === 1 && cell.mvnCalls === 0 && cell.residual === 0, `status=${cell.status} mvn=${cell.mvnCalls} residual=${cell.residual}`);
  check('head fetch 404: keeps the actionable annotation (stdout)', cell.stdout.includes('Maven cache seed helper is unavailable at workflow revision'), cell.stdout.slice(0, 200));
  cleanup(cell);
}
{
  const cell = runCell({ preamble: headP, curlMode: 'fail' });
  check('head network failure: step fails 1 before Maven, no temp file', cell.status === 1 && cell.mvnCalls === 0 && cell.residual === 0, `status=${cell.status} mvn=${cell.mvnCalls} residual=${cell.residual}`);
  cleanup(cell);
}
{
  const cell = runCell({ preamble: headP, mvnStatus: 37 });
  check('head Maven failure: status 37 preserved, no temp file', cell.status === 37 && cell.residual === 0, `status=${cell.status} residual=${cell.residual}`);
  cleanup(cell);
}
{
  const base = runCell({ preamble: baseP, helperPresent: true });
  const head = runCell({ preamble: headP, helperPresent: true });
  check('workspace-helper path: base keeps the helper, no curl', base.status === 0 && base.workspaceHelperPresent && base.curlCalls === 0, `status=${base.status} helper=${base.workspaceHelperPresent} curl=${base.curlCalls}`);
  check('workspace-helper path: head keeps the helper, no curl', head.status === 0 && head.workspaceHelperPresent && head.curlCalls === 0, `status=${head.status} helper=${head.workspaceHelperPresent} curl=${head.curlCalls}`);
  check('workspace-helper path: head installs no cleanup trap', !head.stderr.includes('Permission denied'), 'no trap expected');
  cleanup(base);
  cleanup(head);
}

{
  const base = runCell({ preamble: baseP, mountGuardFail: true });
  const head = runCell({ preamble: headP, mountGuardFail: true });
  check('fail-closed seed guard: base stops before Maven, temp file left', base.status === 1 && base.mvnCalls === 0 && base.residual === 1, `status=${base.status} mvn=${base.mvnCalls} residual=${base.residual}`);
  check('fail-closed seed guard: head stops before Maven, temp file removed', head.status === 1 && head.mvnCalls === 0 && head.residual === 0, `status=${head.status} mvn=${head.mvnCalls} residual=${head.residual}`);
  check('fail-closed seed guard: head keeps the guard diagnostic', head.stdout.includes('filesystem boundaries could not be inspected'), head.stdout.slice(0, 160));
  cleanup(base);
  cleanup(head);
}

console.log('\n== mutants of the head preamble ==');
{
  const noTrap = headP
    .split('\n')
    .filter((line) => !line.trimStart().startsWith("trap 'seed_helper_status="))
    .join('\n');
  const cell = runCell({ preamble: noTrap });
  check('M1 trap removed: temp helper survives (trap is load-bearing)', cell.residual === 1, `residual=${cell.residual}`);
  cleanup(cell);
}
{
  const naive = headP.replace('rm -f -- "${seed_helper}" || true', 'rm -f -- "${seed_helper}"');
  check('M2 mutation actually rewrote the trap', naive !== headP, 'replace was a no-op');
  const cell0 = runCell({ preamble: naive, immutableSeed: true, mvnStatus: 0 });
  const cell37 = runCell({ preamble: naive, immutableSeed: true, mvnStatus: 37 });
  check(
    'M2 naive rm under bash -e: a failing rm rewrites status 0 -> 1',
    cell0.status === 1 && cell0.residual === 1,
    `status=${cell0.status} residual=${cell0.residual}`,
  );
  check(
    'M2 naive rm under bash -e: a failing rm rewrites status 37 -> 1',
    cell37.status === 1 && cell37.residual === 1,
    `status=${cell37.status} residual=${cell37.residual}`,
  );
  check('M2 diagnostic still visible', cell0.stderr.includes('Operation not permitted'), cell0.stderr.slice(0, 120));
  cleanup(cell0);
  cleanup(cell37);
}
{
  const cell0 = runCell({ preamble: headP, immutableSeed: true, mvnStatus: 0 });
  const cell37 = runCell({ preamble: headP, immutableSeed: true, mvnStatus: 37 });
  check(
    'head with the same failing rm: status 0 preserved, diagnostic visible',
    cell0.status === 0 && cell0.residual === 1 && cell0.stderr.includes('Operation not permitted'),
    `status=${cell0.status} residual=${cell0.residual} stderr=${cell0.stderr.slice(0, 120)}`,
  );
  check(
    'head with the same failing rm: status 37 preserved',
    cell37.status === 37 && cell37.residual === 1,
    `status=${cell37.status} residual=${cell37.residual}`,
  );
  cleanup(cell0);
  cleanup(cell37);
}
{
  const deleteWorkspace = headP.replace(
    'source "${seed_helper}"',
    'source "${seed_helper}"\nrm -f -- "${seed_helper}"',
  );
  check('M3 mutation actually inserted the unconditional rm', deleteWorkspace !== headP, 'replace was a no-op');
  const cell = runCell({ preamble: deleteWorkspace, helperPresent: true });
  check(
    'M3 unconditional rm: deletes the checkout helper (control proves the guard)',
    cell.workspaceHelperPresent === false,
    `present=${cell.workspaceHelperPresent}`,
  );
  cleanup(cell);
}

{
  const shipped = runCell({ preamble: headP, immutableSeed: true, mvnStatus: 37 });
  const suggested = runCell({ preamble: headP, immutableSeed: true, mvnStatus: 37, trapRewrite: 'warning' });
  const clean = runCell({ preamble: headP, mvnStatus: 37, trapRewrite: 'warning' });
  const warn = (cell) => (cell.stdout.match(/::warning::/g) ?? []).length;
  check('R1-1 as shipped: a failing cleanup emits no ::warning:: annotation', warn(shipped) === 0 && shipped.status === 37, `warnings=${warn(shipped)} status=${shipped.status}`);
  check('R1-1 suggested || echo: one annotation, status 37 preserved, file remains', warn(suggested) === 1 && suggested.status === 37 && suggested.residual === 1, `warnings=${warn(suggested)} status=${suggested.status} residual=${suggested.residual}`);
  check('R1-1 suggested || echo: the normal path emits no annotation and removes the file', warn(clean) === 0 && clean.status === 37 && clean.residual === 0, `warnings=${warn(clean)} status=${clean.status} residual=${clean.residual}`);
  cleanup(shipped); cleanup(suggested); cleanup(clean);
}

console.log('\n== reference workflow: dead fallback removal ==');
const refHead = join(HEAD_TREE, '.github/workflows/release-managed-agent-reference.yml');
const refBase = join(BASE_TREE, '.github/workflows/release-managed-agent-reference.yml');
const refHeadRun = extractStepRun(refHead, 'Build Java components');
const refBaseRun = extractStepRun(refBase, 'Build Java components');
const refHeadText = readFileSync(refHead, 'utf8');
const refBaseText = readFileSync(refBase, 'utf8');

function checkoutBlock(text) {
  const lines = text.split('\n');
  const idx = lines.findIndex((line) => line.includes('actions/checkout@'));
  if (idx < 0) throw new Error('checkout step not found');
  const indent = lines[idx].match(/^\s*/)[0];
  const block = [];
  for (let i = idx; i < lines.length; i += 1) {
    if (i > idx && lines[i].trim() !== '' && !lines[i].startsWith(`${indent}- `) && lines[i].match(/^\s*/)[0].length < indent.length) break;
    if (i > idx && /^\s*- name:/.test(lines[i]) && lines[i].match(/^\s*/)[0].length <= indent.length) break;
    block.push(lines[i]);
  }
  return block.join('\n');
}
const headCheckout = checkoutBlock(refHeadText);
const baseCheckout = checkoutBlock(refBaseText);
check('reference checkout (head) pins no ref:', !/^\s*ref:/m.test(headCheckout), headCheckout);
check('reference checkout (base) pins no ref:', !/^\s*ref:/m.test(baseCheckout), baseCheckout);
check('reference base fallback URL is self-referential (github.sha)', refBaseRun.includes('${{ github.sha }}') || refBaseRun.includes('${GITHUB_SHA}'), 'no github.sha in base URL');
check('head reference step has no curl', !/\bcurl\b/.test(refHeadRun), refHeadRun.split('\n').filter((l) => /curl/.test(l)).join('|'));
check('head reference step has no mktemp', !refHeadRun.includes('mktemp'), refHeadRun.split('\n').filter((l) => /mktemp/.test(l)).join('|'));

{
  const base = runCell({ preamble: refBaseRun, helperPresent: true, appendMvn: false });
  const head = runCell({ preamble: refHeadRun, helperPresent: true, appendMvn: false });
  check('reference with helper: base runs Maven twice, no curl', base.status === 0 && base.mvnCalls === 2 && base.curlCalls === 0, `status=${base.status} mvn=${base.mvnCalls} curl=${base.curlCalls}`);
  check('reference with helper: head runs Maven twice, no curl', head.status === 0 && head.mvnCalls === 2 && head.curlCalls === 0, `status=${head.status} mvn=${head.mvnCalls} curl=${head.curlCalls}`);
  cleanup(base);
  cleanup(head);
}
{
  const base = runCell({ preamble: refBaseRun, helperPresent: false, curlMode: '404', appendMvn: false });
  const head = runCell({ preamble: refHeadRun, helperPresent: false, curlMode: '404', appendMvn: false });
  check('reference without helper: base attempts the self-referential download and fails', base.status === 1 && base.curlCalls === 1 && base.stdout.includes('unavailable at workflow revision'), `status=${base.status} curl=${base.curlCalls} stdout=${base.stdout.slice(0,120)}`);
  check('reference without helper: head never calls curl', head.curlCalls === 0, `curl=${head.curlCalls}`);
  check('reference without helper: head fails at source with status 1', head.status === 1 && /No such file or directory/.test(head.stderr), `status=${head.status} stderr=${head.stderr.slice(0, 160)}`);
  cleanup(base);
  cleanup(head);
}

console.log(`\nRESULT pass=${pass} fail=${fail} total=${pass + fail}`);
writeFileSync(
  join(dirname(new URL(import.meta.url).pathname), 'ab-assertions.json'),
  JSON.stringify({ pass, fail, total: pass + fail, assertions }, null, 2),
);
writeFileSync(join(dirname(new URL(import.meta.url).pathname), 'ab-raw.json'), JSON.stringify(abRows.map(({ site, headLine, base, head }) => ({ site, headLine, base: { status: base.status, residual: base.residual }, head: { status: head.status, residual: head.residual } })), null, 2));
process.exit(fail === 0 ? 0 : 1);
