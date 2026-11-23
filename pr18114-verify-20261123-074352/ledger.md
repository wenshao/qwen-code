# PR 18114 — follow-up evidence ledger (round 20261123-074352)

head eda83acac9535ae263b3cc7c760d3168fef9808d
base fff678191b40ea223b995e267548c1efeaa351a1 (stacked parent #18100, still open)

## Java focused suite (head vs base)

command: mvn -Dtest=ExternalWorkspaceProvisionerTest,WorkspaceRuntimeResolverTest,ClassSizeRatchetTest,ExternalWorkspaceOwnershipTest,ExternalExecutionGateProbeTest -pl verification -am test

| class | base | head |
| --- | --- | --- |
| ExternalWorkspaceProvisionerTest | 39/39 pass | 38/39, fail aScopeWithoutTheWorkspaceDigestKeepsTheScratchShapedRequest (:151 expected false was true) |
| WorkspaceRuntimeResolverTest | 4/4 pass | 3/4, fail externalManagedExtensionsAreRefusedEvenWhenExtensionsAreConfigured (:66, throws expectation) |
| ClassSizeRatchetTest | 1/1 pass | 0/1, AgentSessionPolicies 785>780 and JdbcRuntimeBindingRepository 2347>2340 |
| ExternalWorkspaceOwnershipTest | 15/16 (fail :200 sharedExternalDrainStopsOnTheStorageFenceAlone) | 15/16 (same case, :200) |
| total | 61 run, 1 fail | 61 run, 4 fail |

## Probe cells (identical probe class in both trees)

| cell | base fff6781 | head eda83aca |
| --- | --- | --- |
| gate(blank cache dir) | absent (no predicate) | true |
| gate(relative cache dir) | absent | true |
| gate(absolute cache dir) | absent | true |
| factory.validate(full config, blank) | IllegalStateException "…managed extension execution… must stay disabled" | accepted |
| factory.validate(full config, relative) | same rejection | accepted |
| factory.validate(full config, absolute) | same rejection | accepted |
| factory.create(blank) | same rejection | IllegalArgumentException "Extension cache must be absolute" |
| factory.create(relative) | same rejection | IllegalArgumentException "Extension cache must be absolute" |
| factory.create(absolute) | same rejection | IllegalStateException "External Workspace provisioning requires the Managed Session Store database" (probe passes RuntimeProviderDependencies.NONE; the cache check passed) |
| provisioner.createRequest(developer digest).isManagedContext | false | true |
| provisioner.createRequest(developer digest).storageId | null | workspace-a |
| HttpRuntimeTransport.withManagedExtensionCacheDirectory("") | IllegalArgumentException | IllegalArgumentException |
| ExternalWorkspaceProvisioner 5-arg ctor with "" | absent (4-arg only) | IllegalArgumentException "Extension cache must be absolute" |

## Checkstyle

head: BUILD FAILURE, 1 violation — persistence/src/main/java/.../WorkspaceAttachmentAuthorizer.java:[3,8] UnusedImports: WorkspaceToolProfiles
base: BUILD SUCCESS

## Test census of the diff

added @Test in Java: 0. Changed Java test files: 0. Modified TS test files: 4 (no new file).

## TypeScript arm (head eda83aca)

build chain (pnpm, setup-worktree.js): core, acp-bridge, network-policy, sdk, web-shell, web-templates, channels/*, cli — all EXIT=0; `error TS` count 0.

| test file | tests | result |
| --- | --- | --- |
| packages/core/src/managed-runtime/managed-tool-publication.test.ts | 74 | 74 pass |
| packages/cli/src/serve/managed-extension-runtime.test.ts + managed-extension-environment.test.ts + hosted-approval-continuation.test.ts | 100 | 100 pass |
| packages/cli/src/serve/hosted-workspace-tool-turn.test.ts | 654 | 654 pass (294 s) |

## Mutation A/B (head arm; restored and sha256-verified after each)

| mutation | suite | result |
| --- | --- | --- |
| delete `if (input['managedExtension'] !== undefined) {...}` in core managed-tool-publication.ts | managed-tool-publication.test.ts | 74/74 pass (SURVIVOR) |
| control: add 'shell' to the shell-input allow-list | same | 2 fail (shell-unknown-key, out-of-shape H3) |
| replace both `this.dependencies.agentsEnabled === false` with `false` | managed-extension-runtime.test.ts | 19/19 pass (SURVIVOR) |
| control: collapse mcp/hooks degradation filter to constant 'mcp' | same | 4 fail |
