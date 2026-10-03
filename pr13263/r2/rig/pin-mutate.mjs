// Mutation check for the new "pins the G0 workspace admission" test, run in a
// mirror directory so the worktree used by the E2E batch is never touched.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const WT = '/Users/wenshao/git/pr13263-head';
const M = '/Users/wenshao/git/pr13263-rig/pinmut';
rmSync(M, { recursive: true, force: true });
mkdirSync(path.join(M, 'scripts/tests'), { recursive: true });
mkdirSync(path.join(M, 'packages/sdk-java/managed-agent-server'), { recursive: true });
cpSync(path.join(WT, 'scripts'), path.join(M, 'scripts'), { recursive: true, filter: (p) => !path.basename(p).startsWith('e2e-v-') });
for (const f of [
  'packages/sdk-java/managed-agent-server/README.md',
  'package.json',
]) {
  cpSync(path.join(WT, f), path.join(M, f));
}
cpSync(path.join(WT, 'integration-tests'), path.join(M, 'integration-tests'), { recursive: true, filter: (s) => !s.includes('node_modules') });
symlinkSync(path.join(WT, 'node_modules'), path.join(M, 'node_modules'));

const target = path.join(M, 'scripts/run-managed-agent-server-e2e.ts');
const head = readFileSync(path.join(WT, 'scripts/run-managed-agent-server-e2e.ts'), 'utf8');
const show = (sha) =>
  execFileSync('git', ['-C', WT, 'show', `${sha}:scripts/run-managed-agent-server-e2e.ts`], { encoding: 'utf8' });

function replace(text, from, to) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`anchor matched ${n}: ${from.slice(0, 100)}`);
  return text.replace(from, () => to);
}

const mutants = {
  'P0 head (control)': head,
  'P1 merge-base runner': show('5130c1a734'),
  'P2 first PR commit 8e1375c380': show('8e1375c380'),
  'P3 re-gate actor header (first Spring)': replace(
    head,
    "        QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER: trustedActorHeader,\n        QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'true',\n        ...(workspaceTurns\n          ? {\n",
    "        QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'true',\n        ...(workspaceTurns\n          ? {\n              QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER: trustedActorHeader,\n",
  ),
  'P4 re-gate workspace files (replacement Spring)': replace(
    head,
    "          QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'true',\n          ...(workspaceTurns\n            ? {\n",
    "          ...(workspaceTurns\n            ? {\n                QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'true',\n",
  ),
  'P5 re-gate broker flags (replacement Harness)': replace(
    head,
    "        '--managed-runtime-broker-url',\n        replacementBrokerProxy?.baseUrl ??\n          `http://127.0.0.1:${replacementBrokerPort}`,\n        `--managed-runtime-broker-token=${brokerToken}`,\n",
    "        ...(workspaceTurns\n          ? [\n              '--managed-runtime-broker-url',\n              replacementBrokerProxy?.baseUrl ??\n                `http://127.0.0.1:${replacementBrokerPort}`,\n              `--managed-runtime-broker-token=${brokerToken}`,\n            ]\n          : []),\n",
  ),
  'P6 re-gate mount-root mkdir': replace(
    head,
    '    workspaceMount,\n    path.join(runtimeHome',
    '    ...(workspaceTurns ? [workspaceMount] : []),\n    path.join(runtimeHome',
  ),
  'P7 re-gate registry/access seeding': replace(
    replace(
      head,
      '  runMysql(\n    mysqlPort,\n    `INSERT INTO qwen_managed_agent.managed_workspace_registry',
      '  if (workspaceTurns) {\n  runMysql(\n    mysqlPort,\n    `INSERT INTO qwen_managed_agent.managed_workspace_registry',
    ),
    "${sqlString(trustedActor)}, TRUE, TRUE)`,\n  );\n",
    "${sqlString(trustedActor)}, TRUE, TRUE)`,\n  );\n  }\n",
  ),
};
mutants['P8 re-gate Spring mount arguments'] = replace(
  head,
  '  springArguments.push(\n    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=${tenant}`,',
  '  if (workspaceTurns) springArguments.push(\n    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=${tenant}`,',
);

const results = [];
for (const [name, text] of Object.entries(mutants)) {
  writeFileSync(target, text);
  const run = spawnSync(
    path.join(M, 'node_modules/.bin/vitest'),
    ['run', '--config', 'scripts/tests/vitest.config.ts', 'scripts/tests/managed-agent-server-e2e.test.js', '-t', 'pins the G0'],
    { cwd: M, encoding: 'utf8', env: { ...process.env, CI: '1' } },
  );
  const out = `${run.stdout}\n${run.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  const passed = /Tests\s+1 passed/.test(out);
  const failed = /Tests\s+1 failed/.test(out);
  const reason = (out.match(/AssertionError: ([^\n]+)/) ?? [])[1] ?? '';
  results.push({ name, outcome: passed ? 'PASS' : failed ? 'FAIL' : 'INVALID', reason: reason.slice(0, 140) });
  console.log(`${name}\t${passed ? 'PASS' : failed ? 'FAIL' : 'INVALID'}\t${reason.slice(0, 140)}`);
}
writeFileSync('/Users/wenshao/git/pr13263-rig/r2/pin-mutants.json', JSON.stringify(results, null, 2));
