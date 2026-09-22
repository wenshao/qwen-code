// What happens when `qwen review fetch-pr` is driven from INSIDE the tool
// execution sandbox (what a confined run_shell_command does)?  Masks are the
// ones each arm's own loadCliConfig produces for a repo-root workspace.
import { mkdirSync, existsSync, realpathSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const [arm, root, masksArg] = process.argv.slice(2);
const repo = realpathSync.native(join(root, 'repo'));
const home = join(root, 'home');
process.env['QWEN_HOME'] = home;
mkdirSync(home, { recursive: true });
const install = (mkdirSync(join(root, 'install'), { recursive: true }), realpathSync.native(join(root, 'install')));
const state = (mkdirSync(join(root, 'state'), { recursive: true }), realpathSync.native(join(root, 'state')));
const masks = masksArg ? masksArg.split(',').filter(Boolean) : [];
for (const m of masks) mkdirSync(m, { recursive: true });
const { admitShellSandbox } = await import(`${arm}/packages/core/dist/src/sandbox/runtime-shell-policy.js`);
const { executeBwrap } = await import(`${arm}/packages/core/dist/src/sandbox/bwrap-execution.js`);
const policy = admitShellSandbox({
  model: '', debugMode: false, cwd: repo, targetDir: repo,
  shellExecutionSandbox: { workspace: repo, installation: install, state, ...(masks.length ? { maskedPaths: masks } : {}), filesystem: 'workspace-write', network: 'closed' },
}, realpathSync.native(home), realpathSync.native(home));
let out = '';
const handle = await executeBwrap(policy, {
  executable: '/bin/bash',
  args: ['-c', `node ${arm}/dist/cli.js review fetch-pr 1 acme/widget --out ${repo}/.qwen/tmp/confined-report.json 2>&1; echo "EXIT=$?"; node -e 'try{require("fs").mkdirSync(process.env.QWEN_HOME+"/review-state/probe",{recursive:true,mode:448});console.log("MKDIR-PROBE: OK")}catch(e){console.log("MKDIR-PROBE:",e.code,e.syscall,e.path)}'`],
  cwd: repo,
  env: { PATH: `${root}/bin:/usr/bin:/bin`, HOME: root, QWEN_HOME: home,
         QWEN_CODE_SESSION_ID: 'sess-confined', QWEN_CODE_PROMPT_ID: 'p1',
         GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_SYSTEM: '/dev/null' },
}, (c) => { out += c; }, AbortSignal.timeout(180000));
const r = await handle.result;
const lsHome = existsSync(join(home, 'review-state')) ? readdirSync(join(home, 'review-state')) : [];
const legacyDir = join(repo, '.qwen', 'review-leases');
console.log(JSON.stringify({
  arm: arm.split('/').pop(), masks: masks.map(m => m.replace(root, '<root>')),
  sandbox: r.sandboxStatus.state,
  output: (r.output || out).split('\n').filter(Boolean).slice(-8),
  hostSeesLeaseNamespace: lsHome,
  hostSeesRetiredLeaseDir: existsSync(legacyDir) ? readdirSync(legacyDir) : 'absent',
  hostSeesWorktree: existsSync(join(repo, '.qwen', 'tmp', 'review-pr-1')),
}, null, 2));
