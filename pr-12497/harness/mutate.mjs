// Two-arm mutation matrix for PR #12497 (test-only).
// For each mutant of packages/core/src/skills/bundled-reference.ts, run:
//   core/HEAD  = PR's workflow-authoring-skill.test.ts
//   core/BASE  = the same file at merge base 99bf4ce (copied beside it)
//   core/BR    = bundled-reference.test.ts (sibling suite)
//   cli/KW     = packages/cli/src/ui/utils/workflow-keyword.test.ts (resolves core src via alias)
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
const ROOT = '/root/verify/pr12497/head';
const SRC = `${ROOT}/packages/core/src/skills/bundled-reference.ts`;
const BASE_TEST = `${ROOT}/packages/core/src/skills/workflow-authoring-skill.basearm.test.ts`;
const orig = fs.readFileSync(SRC, 'utf8');
fs.writeFileSync(BASE_TEST, execSync(`git -C ${ROOT} show 99bf4ce86b:packages/core/src/skills/workflow-authoring-skill.test.ts`));

const GUARD = '  if (config.getToolMode?.() === ToolMode.CodeModeOnly) return false;\n';
const DEFER = '  if (!config.getToolRegistry?.()?.isPermissionDeferred?.(name)) return false;\n';
const HIDDEN_BODY = '  if (!isToolDeferredBehindToolSearch(config, name)) return false;\n  return !config.getToolRegistry?.()?.isDeferredToolRevealed?.(name);\n';
const ROUTE = '    if (isToolDeferredBehindToolSearch(config, ToolNames.SKILL)) {';
const must = (s, a) => { if (!s.includes(a)) throw new Error('anchor missing: ' + a); return s; };
const rep = (a, b) => (s) => must(s, a).replace(a, b);
const seq = (...fs_) => (s) => fs_.reduce((x, f) => f(x), s);

const MUTANTS = [
  ['M0', 'control (unmutated)', (s) => s],
  ['M1', 'delete the CodeModeOnly guard from the shared helper (the PR\'s own RED check)', rep(GUARD, '')],
  ['M2', 'move the guard from the shared helper to the Skill-route call site only', seq(rep(GUARD, ''), rep(ROUTE, "    if (config.getToolMode?.() !== ToolMode.CodeModeOnly && isToolDeferredBehindToolSearch(config, ToolNames.SKILL)) {"))],
  ['M3', 'isToolHiddenBehindToolSearch re-implemented without the shared helper (guard forgotten)', rep(HIDDEN_BODY, "  const registry = config.getToolRegistry?.();\n  if (!registry?.isPermissionDeferred?.(name)) return false;\n  if (config.getVisibleTools?.()?.has(name)) return false;\n  return !registry?.isDeferredToolRevealed?.(name);\n")],
  ['M4', 'guard kept only in isToolHiddenBehindToolSearch (Skill route loses it)', seq(rep(GUARD, ''), rep(HIDDEN_BODY, "  if (config.getToolMode?.() === ToolMode.CodeModeOnly) return false;\n" + HIDDEN_BODY))],
  ['M5', 'guard ANDed with the reveal check (fires only after a ToolSearch reveal)', seq(rep(GUARD, ''), rep(HIDDEN_BODY, "  if (!isToolDeferredBehindToolSearch(config, name)) return false;\n  const revealed = config.getToolRegistry?.()?.isDeferredToolRevealed?.(name);\n  if (config.getToolMode?.() === ToolMode.CodeModeOnly && revealed) return false;\n  return !revealed;\n"))],
  ['B1', 'BENIGN: guard moved after the isPermissionDeferred check', seq(rep(GUARD, ''), rep(DEFER, DEFER + GUARD))],
  ['B2', 'BENIGN: guard duplicated into isToolHiddenBehindToolSearch', rep(HIDDEN_BODY, "  if (config.getToolMode?.() === ToolMode.CodeModeOnly) return false;\n" + HIDDEN_BODY)],
  ['B3', 'BENIGN: guard spelled via Config.getCodeModeOnly() (same meaning on the real Config)', rep(GUARD, '  if (config.getCodeModeOnly?.() === true) return false;\n')],
];

function run(cwd, file) {
  const out = '/root/verify/pr12497/harness/last.json';
  fs.rmSync(out, { force: true });
  const r = spawnSync('npx', ['vitest', 'run', file, '--reporter=json', '--outputFile.json=' + out, '--coverage.enabled=false'], { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
  try {
    const o = JSON.parse(fs.readFileSync(out, 'utf8'));
    return o.numFailedTests === 0 && o.numTotalTests > 0 ? `PASS ${o.numPassedTests}` : `FAIL ${o.numFailedTests}/${o.numTotalTests}`;
  } catch { return 'ERR ' + (r.stderr || '').split('\n').filter(Boolean).slice(-2).join(' | '); }
}
const rows = [];
try {
  for (const [id, desc, f] of MUTANTS) {
    fs.writeFileSync(SRC, f(orig));
    const r = {
      id, desc,
      coreHEAD: run(`${ROOT}/packages/core`, 'src/skills/workflow-authoring-skill.test.ts'),
      coreBASE: run(`${ROOT}/packages/core`, 'src/skills/workflow-authoring-skill.basearm.test.ts'),
      coreBR: run(`${ROOT}/packages/core`, 'src/skills/bundled-reference.test.ts'),
      cliKW: run(`${ROOT}/packages/cli`, 'src/ui/utils/workflow-keyword.test.ts'),
    };
    rows.push(r); console.log(JSON.stringify(r));
  }
} finally {
  fs.writeFileSync(SRC, orig); fs.rmSync(BASE_TEST);
  console.log('restored; git status:', JSON.stringify(execSync(`git -C ${ROOT} status --porcelain`).toString()));
}
fs.writeFileSync('/root/verify/pr12497/harness/matrix.json', JSON.stringify(rows, null, 2));
