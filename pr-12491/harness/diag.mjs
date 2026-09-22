import { mkdirSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const [arm, root] = process.argv.slice(2);
const repo = realpathSync.native(join(root, 'repo'));
const home = join(root, 'home');
process.env['QWEN_HOME'] = home;
const install = (mkdirSync(join(root, 'install'), { recursive: true }), realpathSync.native(join(root, 'install')));
const state = (mkdirSync(join(root, 'state'), { recursive: true }), realpathSync.native(join(root, 'state')));
mkdirSync(join(home, 'review-state'), { recursive: true });
const { admitShellSandbox } = await import(`${arm}/packages/core/dist/src/sandbox/runtime-shell-policy.js`);
const { executeBwrap } = await import(`${arm}/packages/core/dist/src/sandbox/bwrap-execution.js`);
const policy = admitShellSandbox({ model: '', debugMode: false, cwd: repo, targetDir: repo,
  shellExecutionSandbox: { workspace: repo, installation: install, state, filesystem: 'workspace-write', network: 'closed' } },
  realpathSync.native(home), realpathSync.native(home));
let out = '';
const h = await executeBwrap(policy, { executable: '/bin/bash', args: ['-c',
  `echo "-- home visible? --"; ls -la ${home} 2>&1 | head -5; ` +
  `echo "-- mkdir existing-parent --"; mkdir -p ${home}/review-state/xyz 2>&1; ` +
  `echo "-- mkdir deep --"; mkdir -p ${home}/deep/er 2>&1; ` +
  `echo "-- touch in existing dir --"; touch ${home}/review-state/f 2>&1; ` +
  `echo "-- mount view --"; grep -c . /proc/self/mounts; findmnt -no FSTYPE,OPTIONS --target ${home} 2>&1 | head -2`],
  cwd: repo, env: { PATH: '/usr/bin:/bin' } }, (c) => { out += c; }, AbortSignal.timeout(60000));
const r = await h.result;
console.log((r.output || out));
