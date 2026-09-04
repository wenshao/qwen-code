const SB = process.env.SB!;
const ARMS = { base: '/root/git/pr10983-base', pr: '/root/git/pr10983-pr', fix: '/root/git/pr10983-fix' } as const;
const PM: any = {};
for (const [n, wt] of Object.entries(ARMS)) PM[n] = (await import(`${wt}/packages/core/src/permissions/permission-manager.js`)).PermissionManager;
const cfg = (allow: string[], deny: string[], mode: string) => ({
  getPermissionsAllow: () => allow, getPermissionsAsk: () => [], getPermissionsDeny: () => deny,
  getCoreTools: () => undefined, getRegistryAllowList: () => undefined,
  getProjectRoot: () => `${SB}/repo`, getCwd: () => `${SB}/repo`, getApprovalMode: () => mode });
async function v(arm: string, cmd: string, allow: string[], deny: string[], mode: string) {
  const pm = new PM[arm](cfg(allow, deny, mode) as any); pm.initialize();
  return await pm.evaluate({ toolName: 'run_shell_command', command: cmd });
}
const cases: Array<[string, string, string[], string[], string]> = [
  // deny-rule integrity: does a leading assignment let a command slip past a DENY rule?
  ['deny/plain',            'pwned x',                              [], ['Bash(pwned *)'], 'default'],
  ['deny/static-prefix',    'FOO=bar pwned x',                      [], ['Bash(pwned *)'], 'default'],
  ['deny/backtick-IFS',     'X=`id${IFS}-u` pwned x',               [], ['Bash(pwned *)'], 'default'],
  ['deny/NODE_OPTIONS',     'NODE_OPTIONS=--require=/tmp/p.cjs pwned x', [], ['Bash(pwned *)'], 'default'],
  ['deny/PATH',             'PATH=/tmp/evil pwned x',               [], ['Bash(pwned *)'], 'default'],
  // same, under yolo where ONLY deny blocks (ask auto-executes)
  ['yolo/plain',            'pwned x',                              [], ['Bash(pwned *)'], 'yolo'],
  ['yolo/static-prefix',    'FOO=bar pwned x',                      [], ['Bash(pwned *)'], 'yolo'],
  ['yolo/backtick-IFS',     'X=`id${IFS}-u` pwned x',               [], ['Bash(pwned *)'], 'yolo'],
  ['yolo/NODE_OPTIONS',     'NODE_OPTIONS=--require=/tmp/p.cjs pwned x', [], ['Bash(pwned *)'], 'yolo'],
  ['yolo/GIT_CONFIG',       'GIT_CONFIG_GLOBAL=/tmp/e.cfg pwned x', [], ['Bash(pwned *)'], 'yolo'],
  ['yolo/glob-value',       'X=* pwned x',                          [], ['Bash(pwned *)'], 'yolo'],
];
const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);
console.log(pad('case', 24), pad('main', 8), pad('PR', 8), pad('PR+union', 9), 'delta');
console.log('-'.repeat(70));
for (const [id, cmd, allow, deny, mode] of cases) {
  const b = await v('base', cmd, allow, deny, mode), p = await v('pr', cmd, allow, deny, mode), f = await v('fix', cmd, allow, deny, mode);
  const weaker = b === 'deny' && p !== 'deny';
  console.log(pad(id, 24), pad(b, 8), pad(p, 8), pad(f, 9), weaker ? (f === 'deny' ? '<<< PR WEAKENS deny; union restores it' : '<<< DENY WEAKENED') : '');
}
// the union must NOT reopen the allow-side hole
console.log('\nallow-side control (allow: Bash(npm --version), default mode) — the union must NOT reopen it:');
for (const c of ['npm --version', 'X=`pwned${IFS}s` npm --version', 'NODE_OPTIONS=--require=/tmp/p.cjs npm --version', 'FOO=bar npm --version']) {
  console.log('  ', pad(JSON.stringify(c), 46), 'main=', pad(await v('base', c, ['Bash(npm --version)'], [], 'default'), 6),
    'PR=', pad(await v('pr', c, ['Bash(npm --version)'], [], 'default'), 6), 'PR+union=', await v('fix', c, ['Bash(npm --version)'], [], 'default'));
}
