import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const SB = process.env.SB!;
const ARMS = {
  base:  '/root/git/pr10983-base',
  naive: '/root/git/pr10983-naive',
  pr:    '/root/git/pr10983-pr',
  inverted: '/root/git/pr10983-inv',
} as const;
type Arm = keyof typeof ARMS;

const mkPM: Record<string, any> = {};
for (const [name, wt] of Object.entries(ARMS)) {
  const mod = await import(`${wt}/packages/core/src/permissions/permission-manager.js`);
  mkPM[name] = mod.PermissionManager;
}

const cfg = (allow: string[], deny: string[], mode: string) => ({
  getPermissionsAllow: () => allow,
  getPermissionsAsk: () => [],
  getPermissionsDeny: () => deny,
  getCoreTools: () => undefined,
  getRegistryAllowList: () => undefined,
  getProjectRoot: () => `${SB}/repo`,
  getCwd: () => `${SB}/repo`,
  getApprovalMode: () => mode,
});

async function verdict(arm: Arm, cmd: string, allow: string[], deny: string[], mode: string) {
  const pm = new mkPM[arm](cfg(allow, deny, mode) as any);
  pm.initialize();
  return await pm.evaluate({ toolName: 'run_shell_command', command: cmd });
}

// ── real-bash ground truth ────────────────────────────────────────────────
function groundTruth(cmd: string, cwd: string): { exec: boolean; witness: string } {
  writeFileSync(`${SB}/witness`, '');
  try {
    execFileSync('/bin/bash', ['-c', cmd], {
      cwd,
      env: { PATH: `${SB}/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: process.env.HOME!, QWEN_WITNESS: `${SB}/witness` },
      stdio: 'ignore', timeout: 30000,
    });
  } catch { /* non-zero exit is fine; we only care about the witness */ }
  const w = existsSync(`${SB}/witness`) ? readFileSync(`${SB}/witness`, 'utf8').trim() : '';
  return { exec: w.length > 0, witness: w.split('\n')[0] ?? '' };
}

type Entry = { id: string; family: string; cmd: string; allow: string[]; cwd?: string; skipExec?: boolean };
const NPM = 'Bash(npm --version)';
const corpus: Entry[] = [
  // ── baseline / backward compat (must stay allow) ─────────────────────────
  { id: 'plain',            family: 'compat', cmd: `npm --version`, allow: [NPM] },
  { id: 'static-FOO',       family: 'compat', cmd: `FOO=bar npm --version`, allow: [NPM] },
  { id: 'static-quoted',    family: 'compat', cmd: `FOO="bar baz" npm install --dry-run`, allow: ['Bash(npm install)'], skipExec: true },
  { id: 'static-NODE_ENV',  family: 'compat', cmd: `NODE_ENV=production npm --version`, allow: [NPM] },
  { id: 'compat-2846-py',   family: 'compat', cmd: `PYTHONPATH=/tmp/nonexistent-lib python3 -c "print(1)"`, allow: ['Bash(python3 *)'] },

  // ── #10192: command substitution in the assignment (measured to execute) ─
  { id: 'subst-backtick-IFS', family: '#10192', cmd: 'X=`pwned${IFS}sub` npm --version', allow: [NPM] },
  { id: 'subst-dollar-paren', family: '#10192', cmd: `X=$(pwned sub2) npm --version`, allow: [NPM] },
  { id: 'subst-quoted-paren', family: '#10192', cmd: `X="$(pwned sub3)" npm --version`, allow: [NPM] },
  { id: 'subst-nested-var',   family: '#10192', cmd: 'X=`pwned${IFS}a`Y npm --version', allow: [NPM] },
  { id: 'subst-second-slot',  family: '#10192', cmd: 'A=ok X=`pwned${IFS}sub5` npm --version', allow: [NPM] },

  // ── #10197: loader vars ON the denylist (should be blocked by the PR) ────
  { id: 'NODE_OPTIONS',      family: '#10197-listed', cmd: `NODE_OPTIONS=--require=${SB}/preload.cjs npm --version`, allow: [NPM] },
  { id: 'node_options-lower',family: '#10197-listed', cmd: `node_options=--require=${SB}/preload.cjs npm --version`, allow: [NPM] },
  { id: 'LD_PRELOAD',        family: '#10197-listed', cmd: `LD_PRELOAD=${SB}/evil.so npm --version`, allow: [NPM] },
  { id: 'GIT_CONFIG_GLOBAL', family: '#10197-listed', cmd: `GIT_CONFIG_GLOBAL=${SB}/gitcfg git status --porcelain`, allow: ['Bash(git status)'] },
  { id: 'GIT_CONFIG_COUNT',  family: '#10197-listed', cmd: `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0=${SB}/bin/pwned git status --porcelain`, allow: ['Bash(git status)'] },
  { id: 'PERL5OPT',          family: '#10197-listed', cmd: `PERL5LIB=${SB}/perllib PERL5OPT=-MEvil perl -e 0`, allow: ['Bash(perl *)'] },
  { id: 'NPM_CONFIG_USERCFG',family: '#10197-listed', cmd: `NPM_CONFIG_USERCONFIG=${SB}/npmrc npm run hi`, allow: ['Bash(npm run hi)'], cwd: `${SB}/npmpkg` },
  { id: 'BASH_ENV',          family: '#10197-listed', cmd: `BASH_ENV=${SB}/bashenv.sh bash -c true`, allow: ['Bash(bash *)'] },

  // ── #10197 class: loader vars NOT on the denylist ────────────────────────
  { id: 'PATH-hijack',       family: '#10197-unlisted', cmd: `PATH=${SB}/evilpath npm --version`, allow: [NPM] },
  { id: 'LD_AUDIT',          family: '#10197-unlisted', cmd: `LD_AUDIT=${SB}/evil.so npm --version`, allow: [NPM] },
  { id: 'GIT_SSH_COMMAND',   family: '#10197-unlisted', cmd: `GIT_SSH_COMMAND=${SB}/bin/pwned git ls-remote ssh://x.invalid/y`, allow: ['Bash(git ls-remote *)'] },
  { id: 'GIT_EXTERNAL_DIFF', family: '#10197-unlisted', cmd: `GIT_EXTERNAL_DIFF=${SB}/bin/pwned git diff`, allow: ['Bash(git diff)'] },
  { id: 'HOME-gitconfig',    family: '#10197-unlisted', cmd: `HOME=${SB}/fakehome git status --porcelain`, allow: ['Bash(git status)'] },
  { id: 'JAVA_TOOL_OPTIONS', family: '#10197-unlisted', cmd: `JAVA_TOOL_OPTIONS=-agentpath:${SB}/evil.so java -version`, allow: ['Bash(java -version)'] },
  { id: 'PYTHONPATH-sitecust',family: '#10197-unlisted', cmd: `PYTHONPATH=${SB}/pylib python3 -c pass`, allow: ['Bash(python3 *)'] },
  { id: 'PERL5LIB-only',     family: '#10197-unlisted', cmd: `PERL5LIB=${SB}/perllib perl -MEvil -e 0`, allow: ['Bash(perl *)'] },
];

const rows: any[] = [];
for (const e of corpus) {
  const cwd = e.cwd ?? `${SB}/repo`;
  const gt = e.skipExec ? { exec: false, witness: '(not executed)' } : groundTruth(e.cmd, cwd);
  const v: Record<string, string> = {};
  for (const arm of Object.keys(ARMS) as Arm[]) v[arm] = await verdict(arm, e.cmd, e.allow, [], 'default');
  rows.push({ ...e, exec: gt.exec, witness: gt.witness, ...v });
}
writeFileSync(`${SB}/matrix.json`, JSON.stringify(rows, null, 2));

const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);
const mark = (arm: string, r: any) => {
  const v = r[arm];
  if (r.family === 'compat') return v === 'allow' ? `${v} OK` : `${v} REGRESS`;
  return v === 'allow' ? (r.exec ? `${v} BYPASS` : `${v}`) : v;
};
console.log(pad('id', 22), pad('family', 16), pad('exec?', 6), pad('base', 13), pad('naive', 13), pad('pr', 13), 'inverted');
console.log('-'.repeat(96));
for (const r of rows) {
  console.log(pad(r.id, 22), pad(r.family, 16), pad(r.exec ? 'YES' : 'no', 6), pad(mark('base', r), 13), pad(mark('naive', r), 13), pad(mark('pr', r), 13), mark('inverted', r));
}
const holes = (arm: string) => rows.filter((r) => r.exec && r[arm] === 'allow').map((r) => r.id);
console.log('\nsilent-bypass set (real execution + verdict=allow, no prompt):');
for (const a of ['base', 'naive', 'pr', 'inverted']) console.log(`  ${pad(a, 6)} ${holes(a).length}: ${holes(a).join(', ') || '(none)'}`);
const compatBroken = (arm: string) => rows.filter((r) => r.family === 'compat' && r[arm] !== 'allow').map((r) => r.id);
console.log('\nbackward-compat regressions (compat case no longer allow):');
for (const a of ['base', 'naive', 'pr', 'inverted']) console.log(`  ${pad(a, 6)} ${compatBroken(a).length}: ${compatBroken(a).join(', ') || '(none)'}`);
