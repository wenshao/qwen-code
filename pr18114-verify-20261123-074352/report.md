# PR 18114 — execute extensions on external Workspace workers

**Verdict: `findings`** — follow-up at the same head as the previous round. Head `eda83acac9535ae263b3cc7c760d3168fef9808d`, base `fff678191b40ea223b995e267548c1efeaa351a1` (the stacked parent `#18100`, not `main`). The PR is still an open Draft. No commit landed since the last round, so all four carried findings were re-measured instead of quoted: **3 attributable Java failures + 1 A/A red, the cache-directory gate hole, and the checkstyle import all still stand.** This round also fills the previous round's largest gap: the TypeScript tree is now built, type-checked and tested, and two of the PR's new guards are shown to be unpinned by any test.

<details>
<summary>中文摘要</summary>

**结论：`findings`（沿用上一轮，同一 head 复测）。** 验证 head `eda83ac`，base 仍为其叠放的父分支 `fff6781`（#18100，尚未合并）。本轮没有新提交，因此四项旧结论全部重新跑过而不是转述：

1. **（阻断）模块自身测试在 head 红 3 项（可归因）+ 1 项 A/A。** 本轮复跑：`ExternalWorkspaceProvisionerTest` 38/39（`aScopeWithoutTheWorkspaceDigestKeepsTheScratchShapedRequest` 在 :151 断言旧契约）、`WorkspaceRuntimeResolverTest` 3/4（:66）、`ClassSizeRatchetTest` 0/1（`AgentSessionPolicies` 785>780、`JdbcRuntimeBindingRepository` 2347>2340）。`ExternalWorkspaceOwnershipTest.sharedExternalDrainStopsOnTheStorageFenceAlone`（现 :200）在 base/head 同红，非本 PR 引入。base 同选择集 61 跑 1 红。
2. **（主要）执行门禁与 `validate()` 都不检查扩展缓存目录。** 探针（同一份类跑两棵树）：head 的 `isExternalWorkspaceExecutionConfigured()` 对空串、相对路径、绝对路径的 cacheDirectory 全部返回 `true`，`factory.validate()` 对三者全部 `accepted`；随后 `factory.create()` 对空串/相对路径抛 `IllegalArgumentException: Extension cache must be absolute`，对绝对路径越过缓存检查。base 对同一配置在 `validate()` 就明确拒绝（"managed extension execution … must stay disabled"）。设计文档第 35 行明确要求缓存目录。
3. **（次要）checkstyle 在 head 红：** `persistence/.../WorkspaceAttachmentAuthorizer.java:3` 未使用的 import；base 绿。
4. **（次要/覆盖）diff 内零 Java 测试。** 但本轮补上了 TypeScript：整棵 TS 树构建、typecheck 通过（0 个 `error TS`），4 个改动的测试文件全部实跑，另加 2 个相关文件（共 6 个文件、1,700 个测试，零失败）；同时对两个新校验做了变异验证——**删掉 core 新增的 `managedExtension` 校验分支，`managed-tool-publication.test.ts` 仍 74/74 绿；把 `agentsEnabled` 两处判断改成常量 false，`managed-extension-runtime.test.ts` 仍 19/19 绿**。两个正对照（在允许键集合里加 `shell` → 2 红；把 mcp/hooks 降级过滤改成常量 `'mcp'` → 4 红）证明测试对同一函数是敏感的，所以这是真空白，不是探针失灵。

**TypeScript 侧本轮补齐：** 整棵树构建/typecheck 通过（0 个 `error TS`），六个改动测试文件合计 1,700 个测试零失败（含 `hosted-workspace-tool-turn` 654/654、`hosted-harness-session` 872/872）。

**未覆盖：** 没有真实 control-plane + 外部 Worker 的端到端执行；本轮 Java 只跑了 5 个类（61 个用例）而非上一轮的 28 个类——两次全量跑在并发验证轮造成的内存压力下没有留下 `EXIT` 行（未捕获 OOM 记录，属推断），选择集覆盖了上一轮全部红项与探针；MySQL/IT 未跑；web-shell 客户端未用 Playwright 复测（只核对了生成客户端与 OpenAPI 的枚举）。

</details>

## Round state

- The verified head and base are byte-identical to the previous round's (`eda83aca` / `fff6781`); nothing in the diff changed.
- The stacked parent `#18100` is **still open** and its branch has moved two commits past this PR's base (`790b4a52`, `324a3e4c`). One of those commits touches `packages/cli/src/serve/hosted-workspace-tool-turn.test.ts`, which this PR also edits. A trial three-way merge (`git merge-tree --write-tree 324a3e4c eda83aca`) is **clean**, so the movement does not conflict textually.
- The central A/B (base refuses, head admits; `managedExtensions` reaches the handle and boot) was established in the previous round at this same tree pair and is not invalidated by an unchanged head. This round re-executed the admission cells below rather than restating that table.

## A/B — admission cells re-measured (same probe class in both trees)

| cell (same fixture) | base `fff6781` | head `eda83aca` |
| --- | --- | --- |
| `isExternalWorkspaceExecutionConfigured()`, cache dir `""` | predicate absent | `true` |
| same, cache dir `relative/cache` | absent | `true` |
| same, cache dir `/var/cache/qwen-extensions` | absent | `true` |
| `ExternalRuntimeProviderFactory.validate()` on that full config (`""`) | `IllegalStateException: …managed extension execution… must stay disabled` | `accepted` |
| same, `relative/cache` | same rejection | `accepted` |
| same, absolute path | same rejection | `accepted` |
| `ExternalRuntimeProviderFactory.create()` (`""`) | same rejection at `validate` | `IllegalArgumentException: Extension cache must be absolute` |
| `create()`, `relative/cache` | same rejection | same `IllegalArgumentException` |
| `create()`, absolute path | same rejection | passes the cache check; next failure is the probe's absent Session Store |
| `ExternalWorkspaceProvisioner.createRequest(developer digest)` | `isManagedContext=false`, `storageId=null` | `isManagedContext=true`, `storageId=workspace-a` |
| 5-arg `ExternalWorkspaceProvisioner` ctor with `""` | ctor absent (4-arg only) | `IllegalArgumentException: Extension cache must be absolute` |

## Findings

### 1. Blocking — the module's own suite is red at head (3 attributable failures, 1 A/A)

Same selection over both trees:

```bash
export JAVA_HOME=/root/Install/temurin21
export PATH=/root/Install/apache-maven-3.9.11/bin:$PATH
cd <arm>/packages/managed-agent-server
mvn --batch-mode --no-transfer-progress \
  -Dtest='ExternalWorkspaceProvisionerTest,WorkspaceRuntimeResolverTest,ClassSizeRatchetTest,ExternalWorkspaceOwnershipTest,ExternalExecutionGateProbeTest' \
  -Dsurefire.failIfNoSpecifiedTests=false -pl verification -am test
```

| class | base `fff6781` | head `eda83aca` |
| --- | --- | --- |
| `ExternalWorkspaceProvisionerTest` | 39/39 | 38/39 — `aScopeWithoutTheWorkspaceDigestKeepsTheScratchShapedRequest` (`:151`): `expected:<false> but was:<true>` |
| `WorkspaceRuntimeResolverTest` | 4/4 | 3/4 — `externalManagedExtensionsAreRefusedEvenWhenExtensionsAreConfigured` (`:66`): "Expecting code to raise a throwable" |
| `ClassSizeRatchetTest` | 1/1 | 0/1 — `AgentSessionPolicies grew to 785 lines, above its ratchet ceiling 780`; `JdbcRuntimeBindingRepository grew to 2347 lines, above its ratchet ceiling 2340` |
| `ExternalWorkspaceOwnershipTest` | 15/16 — red at `:200` | 15/16 — red at `:200` (A/A) |
| totals | 61 run, 1 red | 61 run, 4 red |

`git diff --numstat` shows both ratcheted classes grew in this PR (`AgentSessionPolicies` +10/−3, `JdbcRuntimeBindingRepository` +9/−2) and neither was split. The two behaviour tests assert the pre-PR contract (a developer digest keeps a scratch-shaped request; managed extensions are refused on external), which is exactly what the PR changes; they need to move with the feature. The fourth red is identical on base, so it is not attributable here, but the new `HarnessOwnership.sharesRuntimeSessions` branch is still exercised by no green test.

### 2. Major — the execution gate and `validate()` omit the cache directory their own factory requires

The design document (`docs/design/2026-11-22-external-workspace-extension-execution.md`, line 35) says: "An extension cache directory and the external provider's registered storage are required." The canonical predicate `ManagedAgentSettings.isExternalWorkspaceExecutionConfigured()` (`ManagedAgentSettings.java:12`) has no cache-directory clause, and `ExternalRuntimeProviderFactory.validate()` does not add one.

Measured: with every documented switch on and `managed-extensions.cache-directory` left at its default empty string, the predicate returns `true` and `validate()` returns `accepted`. The next step throws:

- The call at `create()`'s body, line 37, is `http.withManagedExtensionCacheDirectory(settings.getManagedExtensions().getCacheDirectory(), null)`.
- `HttpRuntimeTransport.withManagedExtensionCacheDirectory` (`:144`) rejects `""` and relative paths with `IllegalArgumentException: Extension cache must be absolute`.
- `EmbeddedRuntimeBroker` builds its provisioner through `RuntimeProviderRegistry().create(...)` at construction (`:560`), so this surfaces as an unclassified startup failure after validation said the configuration was acceptable.
- At base, the same configuration is rejected at validation with the explicit "managed extension execution … must stay disabled" message, so this is a regression in where and how the prerequisite is reported, not a new data path. It fails closed, but `JdbcManagedWorkspaceRegistry.externalExtensionsAvailable()` uses this predicate to advertise the profile, so it should not answer "configured" for a configuration its own factory cannot build.

Related: `ExternalWorkspaceProvisioner.validateProfile` (`:273`) only rejects `extensionCacheDirectory == null`; the property default is `""`, and the factory passes the raw value, so a blank or relative value is caught by the transport constructor (as an `IllegalArgumentException`) instead of by validation.

A minimal fix is one absolute-cache-directory clause in the gate and in `validate()`, plus a blank check in `validateProfile`. I did not apply it: the probe pins the current cells, and a fixed third arm would be needed to prove the fix.

### 3. Minor — checkstyle fails at head

```bash
cd <arm>/packages/managed-agent-server
mvn --batch-mode --no-transfer-progress -pl '!verification' checkstyle:check
```

Base: `BUILD SUCCESS`. Head: `BUILD FAILURE` with one violation:

```
persistence/src/main/java/com/alibaba/qwen/code/managedagent/persistence/WorkspaceAttachmentAuthorizer.java:[3,8]
(imports) UnusedImports: Unused import - com.alibaba.qwen.code.managedagent.contracts.workspace.WorkspaceToolProfiles.
```

The PR replaced that file's last use of `WorkspaceToolProfiles` and left the import. `.github/workflows` has no managed-agent job, so this is a configured local gate, not a proven CI block.

### 4. Minor / coverage — the new Java lane has no test, and two new TS guards are unpinned

The diff adds **zero** `@Test` methods under `packages/managed-agent-server/**/src/test/java` and changes no Java test file. The TypeScript side has four modified test files and no new file, and only one of them asserts behaviour this PR changes (the `PYTHONDONTWRITEBYTECODE` expectation). Mutation A/B on the head arm, each with a positive control on the same function:

| mutation | test file | result |
| --- | --- | --- |
| delete the whole `if (input['managedExtension'] !== undefined) {…}` block in `core/src/managed-runtime/managed-tool-publication.ts` | `managed-tool-publication.test.ts` | **74/74 pass — survivor** |
| control: add `'shell'` to that shell-input allow-list | same | 2 red (`shell-unknown-key`, `rejects out-of-shape H3 payloads…`) |
| replace both `this.dependencies.agentsEnabled === false` comparisons with `false` in `cli/src/serve/managed-extension-runtime.ts` | `managed-extension-runtime.test.ts` | **19/19 pass — survivor** |
| control: collapse the mcp/hooks degradation filter to a constant `'mcp'` | same | 4 red |

The first survivor is the session-binding check for extension Shell publication (`harnessSessionId` must equal the binding's session, pin shape, revision bounds); the second is the `agents` admission/degradation path the PR body advertises ("Public child Agents are reported as degraded"). Both pass every test in the repo while broken.

Also note: the new case in `hosted-approval-continuation.test.ts` ("does not borrow another approval continuation…") pins `findHostedApprovalContinuation`, and that source file is not touched by this PR — the case is a characterization guard for pre-existing behaviour, not evidence for this diff.

## TypeScript arm (new this round)

The previous round did not build or run any TypeScript. This round:

- `node scripts/setup-worktree.js` (pinned pnpm, frozen lockfile) in the head arm.
- Build chain `core → acp-bridge → network-policy → sdk → web-shell → web-templates → cli`, plus the 12 `packages/channels/*` packages the CLI's `tsc --build` needs. Final CLI build `EXIT=0`, `error TS` count 0 (full-root build that the filter chain also triggers, `EXIT=0`).
- `packages/cli`: `managed-extension-runtime.test.ts` + `managed-extension-environment.test.ts` + `hosted-approval-continuation.test.ts` → **100/100 pass**; `managed-tool-publication.test.ts` in `packages/core` → **74/74 pass**.
- The two large changed files also pass: `hosted-workspace-tool-turn.test.ts` **654/654** (294 s) and `hosted-harness-session.test.ts` **872/872** (636 s). In total **1,700 tests across the six files, zero failures** — the TypeScript side of this PR is green where it is tested; the gap is what is *not* tested (Finding 4).

## Not covered

- **No end-to-end control-plane + external Worker execution.** No real Skill script, MCP tool or hook was observed against a registered Worker; the design's acceptance criteria remain unverified here.
- **Java scope.** This round ran the 5 classes above (61 tests). The two attempts at the previous round's 28-class selection ended without an `EXIT` line while the host was under memory pressure from concurrent verify rounds (free memory hit 0); I did not capture an OOM record, so the cause is inferred. The other 23 classes therefore were not re-executed here. The trees are the same OIDs as the previous round's run, and the selection above contains every class that was red there.
- **MySQL / `*IT` suites, JDBC-backed recovery paths** — not exercised.
- **web-shell client** — not re-generated or rendered under Playwright; only the `agents` enum in the OpenAPI and the generated client were compared textually.

## Methodology

Base and head were materialized as detached worktrees at `fff678191b40…` and `eda83acac953…`; each arm compiles independently with Temurin 21 + Maven 3.9.11 and a shared `~/.m2` (no `install` goal). The probe class (`ExternalExecutionGateProbeTest`, `verification/src/test/java/.../runtimebroker/probing/`) exists only in the scratch trees and writes `PROBE …` lines to a file; it is the same source in both arms. The TypeScript arm used the pnpm tree from `scripts/setup-worktree.js` plus scratch vitest configs (the repo's `globalSetup` guard copied and removed, everything else identical). Mutations were applied to the head arm, measured, then restored with `git checkout --` and verified by `sha256sum`. Raw logs, the probe output and the mutation logs live in `tmp/pr18114-verify-20261123-074352/logs/`.

## Evidence

Round artifacts live under [`pr18114-verify-20261123-074352`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352) on the fork's `asserts` branch:

- [`ledger.md`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/ledger.md) — every measured Java/probe/TS cell in one table.
- Java: [`head-java-focus.log`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/head-java-focus.log), [`base-java-focus.log`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/base-java-focus.log), [`head-checkstyle.log`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/head-checkstyle.log), [`base-checkstyle.log`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/base-checkstyle.log).
- Probe: [`head-probe.rows.txt`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/head-probe.rows.txt), [`base-probe.rows.txt`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/base-probe.rows.txt), source [`ExternalExecutionGateProbeTest.java`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/ExternalExecutionGateProbeTest.java).
- TypeScript: [`head-ts-build.log`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/head-ts-build.log), [`head-cli-tests.log`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/head-cli-tests.log), [`head-cli-big-tests.log`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/head-cli-big-tests.log), [`head-core-publication.log`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/head-core-publication.log).
- Mutation A/B: [`head-core-m1-delete-guard.log`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/head-core-m1-delete-guard.log) (survivor), [`head-core-m2-control.log`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/head-core-m2-control.log) (control), [`head-cli-m3-agents-disabled.log`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/head-cli-m3-agents-disabled.log) (survivor), [`head-cli-m4-control.log`](https://github.com/wenshao/qwen-code/blob/asserts/pr18114-verify-20261123-074352/head-cli-m4-control.log) (control).
