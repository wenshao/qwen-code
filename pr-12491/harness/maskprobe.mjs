// Real loadCliConfig from each arm's built dist: does the CLI append its own
// mask to an operator-supplied executionSandbox policy?
import { mkdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
const arm = process.argv[2];
const root = process.argv[3];
const ws = realpathSync.native((mkdirSync(join(root, 'workspace'), { recursive: true }), join(root, 'workspace')));
mkdirSync(join(ws, 'secrets'), { recursive: true });
const install = (mkdirSync(join(root, 'install'), { recursive: true }), realpathSync.native(join(root, 'install')));
const state = (mkdirSync(join(root, 'state'), { recursive: true }), realpathSync.native(join(root, 'state')));
process.env['QWEN_HOME'] = (mkdirSync(join(root, 'home'), { recursive: true }), join(root, 'home'));
process.chdir(ws);
const { loadCliConfig, parseArguments } = await import(`${arm}/packages/cli/dist/src/config/config.js`);
process.argv = ['node', 'script.js', '--bare', '-p', 'fixture'];
const argv = await parseArguments();
const policy = {
  workspace: ws, installation: install, state,
  maskedPaths: [join(ws, 'secrets')],
  filesystem: 'workspace-write', network: 'closed',
};
const config = await loadCliConfig({}, argv, ws, [], undefined, undefined, undefined, undefined, false, { shellExecutionSandbox: policy });
const out = config.getShellExecutionSandbox();
console.log(JSON.stringify({
  arm: arm.split('/').pop(),
  requestedMasks: policy.maskedPaths.map(p => p.replace(root, '<root>')),
  effectiveMasks: (out?.maskedPaths ?? []).map(p => p.replace(root, '<root>')),
  appendedByTheCli: (out?.maskedPaths ?? []).filter(p => !policy.maskedPaths.includes(p)).map(p => p.replace(root, '<root>')),
}, null, 2));
