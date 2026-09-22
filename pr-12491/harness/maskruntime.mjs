// Does an operator-declared mask still hide the host path at runtime (head arm)?
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
const arm = process.argv[2], root = process.argv[3];
const ws = (mkdirSync(join(root, 'workspace', 'secrets'), { recursive: true }), realpathSync.native(join(root, 'workspace')));
writeFileSync(join(ws, 'secrets', 'host-secret.txt'), 'HOST SECRET\n');
const install = (mkdirSync(join(root, 'install'), { recursive: true }), realpathSync.native(join(root, 'install')));
const state = (mkdirSync(join(root, 'state'), { recursive: true }), realpathSync.native(join(root, 'state')));
process.env['QWEN_HOME'] = (mkdirSync(join(root, 'home'), { recursive: true }), join(root, 'home'));
const { admitShellSandbox } = await import(`${arm}/packages/core/dist/src/sandbox/runtime-shell-policy.js`);
const { executeBwrap } = await import(`${arm}/packages/core/dist/src/sandbox/bwrap-execution.js`);
const run = async (maskedPaths) => {
  const policy = admitShellSandbox({
    model: '', debugMode: false, cwd: ws, targetDir: ws,
    shellExecutionSandbox: { workspace: ws, installation: install, state, maskedPaths, filesystem: 'workspace-write', network: 'closed' },
  }, realpathSync.native(join(root, 'home')), realpathSync.native(join(root, 'home')));
  let out = '';
  const handle = await executeBwrap(policy, {
    executable: '/bin/bash',
    args: ['-c', 'echo "sees: [$(cat secrets/host-secret.txt 2>&1)]"; echo PLANT > secrets/planted.txt && echo "wrote into masked dir"'],
    cwd: ws, env: { PATH: '/usr/bin:/bin' },
  }, (c) => { out += c; }, AbortSignal.timeout(30000));
  const r = await handle.result;
  return { masks: (policy.maskedPaths ?? []).map(p => p.replace(root, '<root>')), output: (r.output || out).trim(), status: r.sandboxStatus.state,
           hostSecretIntact: readFileSync(join(ws, 'secrets', 'host-secret.txt'), 'utf8').trim(),
           plantedOnHost: existsSync(join(ws, 'secrets', 'planted.txt')) };
};
console.log('WITH the operator mask   :', JSON.stringify(await run([join(ws, 'secrets')])));
console.log('WITHOUT any mask (control):', JSON.stringify(await run(undefined)));
