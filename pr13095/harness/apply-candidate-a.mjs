// Candidate A (optional, test-only), rebased onto ad80a75dd4: pins the three store guards that still survive
// the fast lane (config-ref, agent-id, files opt-in) with the PR's own fixture shape.
// usage: node apply-candidate-a.mjs <worktree>
import { readFileSync, writeFileSync } from 'node:fs';
const f = `${process.argv[2]}/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/ManagedWorkspaceAdmissionTest.java`;
let s = readFileSync(f, 'utf8');
const rep = (from, to) => { if (s.split(from).length !== 2) throw new Error(`anchor not unique: ${from.slice(0, 60)}`); s = s.replace(from, to); };
rep(`        for (String workspace : List.of("ws-valid", "ws-policy", "ws-tenant")) {
            grant(tenant, workspace, "actor-a", true);
        }`,
`        register(tenant, "ws-config", "storage-config",
                "managed-runtime-tools/2",
                WorkspaceExecutionProfile.POLICY_REF);
        for (String workspace : List.of("ws-valid", "ws-policy", "ws-tenant",
                "ws-config")) {
            grant(tenant, workspace, "actor-a", true);
        }`);
rep(`                new ManagedAgentProperties.RuntimeBroker.WorkspaceMount(
                        otherTenant, "storage-shared", "/unused/shared")));`,
`                new ManagedAgentProperties.RuntimeBroker.WorkspaceMount(
                        tenant, "storage-config", "/unused/config"),
                new ManagedAgentProperties.RuntimeBroker.WorkspaceMount(
                        otherTenant, "storage-shared", "/unused/shared")));`);
rep(`                }, registry, enabled);
`,
`                }, registry, enabled);
        // Same mounts with the files opt-in off: only the opt-in guard can
        // refuse the otherwise admissible Workspace.
        ManagedAgentProperties optedOut = new ManagedAgentProperties();
        optedOut.getRuntimeBroker().setWorkspaceMounts(
                enabled.getRuntimeBroker().getWorkspaceMounts());
        ManagedAgentStore disabled = new ManagedAgentStore(jdbc, mapper,
                Clock.systemUTC(), ignored -> {
                }, registry, optedOut);
`);
rep(`        for (String workspace : List.of("ws-policy", "ws-tenant")) {
            // Captured first so the label survives when nothing is thrown.
            Throwable thrown = catchThrowable(() -> transaction.execute(status ->
                    gated.insertWorkspaceSessionCommand(tenant, "actor-a",
                            workspace, digest, "qwen-code", null, null, input,
                            digest, new WorkspaceSelection(workspace, "."))));
            assertThat(thrown).as(workspace)`,
`        record Refusal(String name, ManagedAgentStore store,
                String workspace, String agent) {
        }
        for (Refusal refusal : List.of(
                new Refusal("ws-policy", gated, "ws-policy", "qwen-code"),
                new Refusal("ws-tenant", gated, "ws-tenant", "qwen-code"),
                new Refusal("ws-config", gated, "ws-config", "qwen-code"),
                new Refusal("another-agent", gated, "ws-valid",
                        "another-agent"),
                new Refusal("files-disabled", disabled, "ws-valid",
                        "qwen-code"))) {
            // Captured first so the label survives when nothing is thrown.
            Throwable thrown = catchThrowable(() -> transaction.execute(
                    status -> refusal.store().insertWorkspaceSessionCommand(
                            tenant, "actor-a", refusal.name(), digest,
                            refusal.agent(), null, null, input, digest,
                            new WorkspaceSelection(refusal.workspace(),
                                    "."))));
            assertThat(thrown).as(refusal.name())`);
writeFileSync(f, s);
console.log('candidate A applied');
