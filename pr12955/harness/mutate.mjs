// usage: node mutate.mjs <id>   -- applies one exact-string mutant in wt-mut (asserts one hit)
import fs from 'node:fs';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad';
const S = `${SP}/wt-mut/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent`;
const D = `${SP}/wt-mut/packages/sdk-java/qwencode/src/main/java/com/alibaba/qwen/code/daemon`;
const C = `${S}/harness/QwenHostedHarnessConnector.java`;
const ST = `${S}/store/ManagedAgentStore.java`;
const P = `${S}/config/ManagedAgentProperties.java`;

export const MUTANTS = {
  M1: [C, 'workspaceExecution.authorize(session);', '/* M1 */'],
  M2: [C, `.workspaceId(session.workspace() == null ? workspaceId
                        : session.workspace().getWorkspaceId())`, '.workspaceId(workspaceId)'],
  M3: [C, 'passiveManagedRuntimeRecovery, toolProfile(session)));', 'passiveManagedRuntimeRecovery, null));'],
  M4: [C, '.toolProfile(toolProfile(session));', '.toolProfile(null);'],
  M5: [C, `if (!isWorkspaceFilesAvailable()) {
                throw new IllegalStateException("Hosted Workspace files are disabled");
            }`, '/* M5 */'],
  M6: [ST, `                        || workspaceMounts.stream().noneMatch(mount ->
                                tenantId.equals(mount.tenantId())
                                        && workspace.binding().getStorageId().equals(mount.storageId())))) {`, `)) {`],
  M7: [ST, `                        || !WorkspaceExecutionProfile.CONFIG_REF.equals(workspace.configRef())
                        || !WorkspaceExecutionProfile.POLICY_REF.equals(workspace.policyRef())`, ''],
  M8: [ST, `&& (!"qwen-code".equals(agentId)
                        || !WorkspaceExecutionProfile.CONFIG_REF`, `&& (false
                        || !WorkspaceExecutionProfile.CONFIG_REF`],
  M9: [ST, 'if (!input.isEmpty() && !workspaceFilesEnabled) {', 'if (false) {'],
  M10: [`${S}/service/ManagedAgentService.java`, 'if (!input.isEmpty() && !harness.isWorkspaceFilesAvailable()) {', 'if (false) {'],
  M11: [`${S}/service/HarnessCoordinator.java`, 'if (session.workspace() != null && !harness.isWorkspaceFilesAvailable()) {', 'if (session.workspace() != null) {'],
  M12: [`${S}/service/HarnessCoordinator.java`, 'if (session.workspace() != null && !harness.isWorkspaceFilesAvailable()) {', 'if (false) {'],
  M13: [P, `|| !"session".equals(runtimeBroker.getIsolationClass())`, ''],
  M14: [P, `|| !"yolo".equalsIgnoreCase(harness.getApprovalMode())`, ''],
  M15: [P, `|| runtimeBroker.getWorkspaceMounts().isEmpty()`, ''],
  M16: [ST, `tenantId.equals(mount.tenantId())
                                        && `, ''],
  M17: [`${D}/CreateHarnessSession.java`, `result.put("toolProfile", toolProfile);`, '/* M17 */'],
  M18: [`${D}/LoadHarnessSession.java`, `result.put("toolProfile", toolProfile);`, '/* M18 */'],
  M19: [P, `|| !"local-process".equals(runtimeBroker.getProvisioner())`, ''],
  M20: [P, `(!harness.isEnabled() || !sessionStore.isEnabled()`, `(!harness.isEnabled() || false`],
};

const id = process.argv[2];
if (id) {
  const [file, from, to] = MUTANTS[id];
  const src = fs.readFileSync(file, 'utf8');
  const hits = src.split(from).length - 1;
  if (hits !== 1) {
    console.error(`${id}: expected 1 hit, got ${hits}`);
    process.exit(2);
  }
  fs.writeFileSync(file, src.replace(from, to));
  console.log(`${id} applied to ${file.split('/').pop()}`);
}
