const SB = process.env.SB!;
const ARMS = { base: '/root/git/pr10983-base', pr: '/root/git/pr10983-pr' } as const;
const PM: any = {}; const RP: any = {};
for (const [n, wt] of Object.entries(ARMS)) {
  PM[n] = (await import(`${wt}/packages/core/src/permissions/permission-manager.js`)).PermissionManager;
  RP[n] = await import(`${wt}/packages/core/src/permissions/rule-parser.js`);
}
const cfg = (allow: string[]) => ({ getPermissionsAllow: () => allow, getPermissionsAsk: () => [], getPermissionsDeny: () => [],
  getCoreTools: () => undefined, getRegistryAllowList: () => undefined, getProjectRoot: () => `${SB}/repo`, getCwd: () => `${SB}/repo`, getApprovalMode: () => 'default' });
async function v(arm: string, cmd: string, allow: string[]) { const pm = new PM[arm](cfg(allow) as any); pm.initialize(); return await pm.evaluate({ toolName: 'run_shell_command', command: cmd }); }
const N = 'Bash(npm --version)';
const cases: Array<[string, string, string[]]> = [
  ['compound-2nd-slot',    `FOO=bar npm --version && NODE_OPTIONS=--require=${SB}/preload.cjs npm --version`, [N]],
  ['compound-sep-newline', `npm --version\nNODE_OPTIONS=--require=${SB}/preload.cjs npm --version`, [N]],
  ['subshell',             `(NODE_OPTIONS=--require=${SB}/preload.cjs npm --version)`, [N]],
  ['env-command',          `env NODE_OPTIONS=--require=${SB}/preload.cjs npm --version`, [N, 'Bash(env *)']],
  ['leading-space',        `   NODE_OPTIONS=--require=${SB}/preload.cjs npm --version`, [N]],
  ['tab-separated',        `NODE_OPTIONS=--require=${SB}/preload.cjs\tnpm --version`, [N]],
  ['dropped-cmd-word',     `X=1 $UNSET npm --version`, [N]],
  ['name-with-equals-val', `FOO=a=b npm --version`, [N]],
  ['empty-value',          `FOO= npm --version`, [N]],
  ['unbalanced-quote',     `FOO="bar npm --version`, [N]],
  ['NODE_OPTIONS-quoted',  `NODE_OPTIONS="--require=${SB}/preload.cjs" npm --version`, [N]],
  ['NODE_OPTIONS-esc',     `NODE_OPTIONS=--require\\=${SB}/preload.cjs npm --version`, [N]],
  ['NODE_OPTIONS-concat',  `NODE_OPTIO""NS=--require=${SB}/preload.cjs npm --version`, [N]],
  ['PATH-with-append',     `PATH=${SB}/evilpath:/usr/bin npm --version`, [N]],
];
const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);
console.log(pad('case', 22), pad('base', 8), pad('pr', 8), 'raw command');
for (const [id, cmd, allow] of cases) {
  console.log(pad(id, 22), pad(await v('base', cmd, allow), 8), pad(await v('pr', cmd, allow), 8), JSON.stringify(cmd.replace(SB, '$SB')).slice(0, 78));
}
console.log('\nperf: matchesCommandPattern x20000');
for (const arm of ['base', 'pr']) {
  const t = Date.now();
  for (let i = 0; i < 20000; i++) RP[arm].matchesCommandPattern('npm *', 'FOO=bar BAZ=qux npm install --save-dev typescript');
  console.log(`  ${arm}: ${Date.now() - t} ms`);
}
