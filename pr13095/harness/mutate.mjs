// Applies exactly one production mutation to a rig worktree, or restores it.
// usage: node mutate.mjs <worktree dir> <mutant id | restore | list>
// Every mutant must match its anchor exactly once, otherwise the script exits non-zero
// so that a mutation that did not apply can never be counted as a survivor.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [, , tree, id] = process.argv;
const MAIN = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent';
const STORE = `${MAIN}/store/ManagedAgentStore.java`;
const REGISTRY = `${MAIN}/store/ManagedWorkspaceRegistry.java`;

// `re` is whitespace-tolerant source text; `to` is the replacement.
const ws = (s) => new RegExp(s.trim().split(/\s+/).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'));
export const MUTANTS = {
  M1: { file: STORE, what: 'policy-ref conjunct removed',
    re: ws('|| !WorkspaceExecutionProfile.POLICY_REF.equals(workspace.policyRef())'), to: '' },
  M2: { file: STORE, what: 'mount tenant conjunct removed',
    re: ws('tenantId.equals(mount.tenantId()) &&'), to: '' },
  M4: { file: STORE, what: 'whole mount clause removed',
    re: ws('|| workspaceMounts.stream().noneMatch(mount -> tenantId.equals(mount.tenantId()) && workspace.binding().getStorageId().equals(mount.storageId()))'), to: '' },
  M5: { file: STORE, what: 'config-ref conjunct removed',
    re: ws('|| !WorkspaceExecutionProfile.CONFIG_REF.equals(workspace.configRef())'), to: '' },
  M6: { file: STORE, what: 'agent-id conjunct made false',
    re: ws('!"qwen-code".equals(agentId)'), to: 'false' },
  M7: { file: STORE, what: 'workspaceFilesEnabled early guard removed',
    re: ws('if (!input.isEmpty() && !workspaceFilesEnabled) {'), to: 'if (false) {' },
  M8: { file: STORE, what: 'mount storage-id conjunct removed',
    re: ws('&& workspace.binding().getStorageId().equals(mount.storageId())'), to: '' },
  C1: { file: REGISTRY, what: 'registry non-ACTIVE refusal code changed (409 kept)',
    re: ws('"workspace_unavailable", "Workspace is unavailable."'), to: '"workspace_draining_mutated", "Workspace is unavailable."' },
  C2: { file: STORE, what: 'store execution-unavailable code changed (409 kept)',
    re: ws('"workspace_unavailable", "Hosted Workspace execution is not available."'), to: '"workspace_execution_mutated", "Hosted Workspace execution is not available."' },
};

if (id === 'list') {
  for (const [k, v] of Object.entries(MUTANTS)) console.log(`${k}\t${v.what}`);
  process.exit(0);
}
if (id === 'restore') {
  execFileSync('git', ['-C', tree, 'checkout', '--', `${MAIN}`], { stdio: 'inherit' });
  const dirty = execFileSync('git', ['-C', tree, 'status', '--porcelain', '--', MAIN]).toString().trim();
  if (dirty) { console.error(`restore left changes:\n${dirty}`); process.exit(2); }
  console.log(`restored ${path.basename(tree)} (production tree clean)`);
  process.exit(0);
}
const m = MUTANTS[id];
if (!m) { console.error(`unknown mutant ${id}`); process.exit(2); }
const file = path.join(tree, m.file);
const src = readFileSync(file, 'utf8');
const all = src.match(new RegExp(m.re.source, 'g')) ?? [];
if (all.length !== 1) { console.error(`${id}: anchor matched ${all.length} times, expected 1`); process.exit(3); }
writeFileSync(file, src.replace(m.re, m.to));
const stat = execFileSync('git', ['-C', tree, 'diff', '--numstat', '--', MAIN]).toString().trim();
console.log(`applied ${id} (${m.what}) -> ${stat.replace(/\s+/g, ' ')}`);
