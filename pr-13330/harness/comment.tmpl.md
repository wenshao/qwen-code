## Maintainer verification — #13330 @ `c096be36` (real-environment run)

**Verdict: not ready to merge as-is.** Several items hold, and I reproduced each improvement against the base: the archive/delete fence (now restart-safe), the connector close race, startup validation for the base URL and the lease/renew pair, the Kubernetes wording, and the starvation half of the backoff. One problem blocks the merge. The close-path fence regression flagged in the Stage-2 triage review reproduces end to end. A second problem should also be fixed in this PR: the identity divergence the triage flagged reproduces with the production classes, though it is latent today. Two items have no runtime effect yet: the rename cause, and the warn-flood half of the backoff. Item 2 is no longer in the diff. Both fixes are small. I applied a two-file candidate patch locally, and it passes every probe and the full suite (details below).

> Note: the takeover rounds never picked up the Stage-2 `request changes` (round 1 resolved a merge conflict, round 2 retried a CI flake, and round 3 reported "no actionable feedback"). Both Criticals are still present at this head.

**Rig.** The base arm is the merge-base `3172c9fd`. Between the two arms the production diff is exactly the PR's 9 files, and the PR merges cleanly into current `main` (`69d5db2f`). Java runs on `eclipse-temurin:21-jdk`, the CI JDK. The databases are H2 and MariaDB `10.11.18`, the same MariaDB image as CI. For the full-stack run I built and bundled the CLI from this head (`pnpm install`, `build`, `bundle`), then ran a real `qwen serve --profile hosted-harness` together with the Spring server, the Session Store and the embedded Runtime Broker. Every probe drives the production classes on the path under test. The only fakes are the model and a few collaborators off that path.

### Results by item

| # | Item | Result | Evidence |
|---|---|---|---|
| 1a | Durable ARCHIVED/DELETED fence | ✅ works, and it **survives a restart**. On base, a restarted server warms archived and deleted Sessions (a real `READY` runtime binding) | Fig. 1 |
| 1b | "Close keeps its in-process retirement" | ❌ **regression vs main.** A CLOSED unbound Session warms a real runtime worker in the same process. `drain()` reads the row while it is still `CLOSING`, so it never retires. This is the triage Stage-2 Critical #2 | Fig. 1 |
| 2 | Attach fetch moved out of `computeIfAbsent` | ⚠️ **No longer in this diff.** It was superseded by #13403 on main during the merge. `loadsOnceAcrossConcurrentFreeAttachCalls` now pins #13403's code and passes on base too. The PR body still describes the old change | diff |
| 3 | Connector close race | ✅ | mutants {{M3}} |
| 4 | Schemeless base URL | ✅ The real server refuses to start with a clear message. On base it starts, and the first rename returns 503 with 0 log lines | Fig. 4 |
| 5 | Tool-item identity `:call:` tag | ⚠️ **Latent divergence (triage Critical #1 reproduced with production classes).** Tool calls now land in two items, and `GET /items/{call}/tool-result` returns 404. It is **not reachable in today's hosted stack** (Fig. 3), so I rate it should-fix, not live-broken | Fig. 2, 3 |
| 6 | Lease/renew validation | ✅ The real server refuses to start | Fig. 4 |
| 7 | Rename 503 cause chaining | ⚠️ **No runtime effect.** `ApiExceptionHandler.api()` never logs an `ApiException`, so with a dead Hosted Harness the server writes **0 log lines** on both arms | Fig. 4 |
| 8 | Materializer backoff | ✅ Starvation is fixed: with 33 poisoned Sessions, a healthy event materializes after **181 ms** (base: **never** within 15 s). ⚠️ The warn flood is **not** fixed: once the streak reaches the 64 cap (about 6.5 s), every pass attempts and warns again, at 10/s, the same as base | Fig. 4 |
| 9 | Kubernetes rejection wording | ✅ | Fig. 4 |

### Finding A (blocking): CLOSED unbound Sessions are no longer fenced

![close fence]({{IMG1}})

I booted the real `ManagedAgentServerApplication` on an H2 file database. Each Session went through `POST /close`, `/archive` or `DELETE` on the public API, and then I called `EmbeddedRuntimeBroker.warm(sessionId)`, which is the call `HarnessCoordinator.warmRuntime` makes when a Turn is dispatched. The provisioner was `local-process`, so a warm that passes the fence starts a real worker (`qwen_runtime_binding` `READY`). The results match the static trace: `deliver()` runs `settle()` → `drain()` *before* `completeOperation()`, the row still reads `CLOSING`, `drain()` retires nothing, and the resolver only fences ARCHIVED/DELETED. `drainStillRetiresAClosedSessionInProcess` stays green only because it mocks the row to `CLOSED`, a state it can never be in at that point.

Reachability is limited: close requires no active Turn, so the regression needs a dispatch/close race. It is still defense-in-depth that main has and this PR removes. It also leaves the restart gap open for closed Sessions, which this item was meant to close.

### Finding B (should fix in this PR): the two copies of the tool-item id rule diverge

![tool item identity]({{IMG2}})

This probe drives the production `HarnessEventProjector`, `ManagedToolResultProjector`, `ManagedAgentStore` and `ManagedArtifactController` over a real committed shell publication. Base always produces one merged item. Head splits it in all three orders:

- **A:** a harness update arrives after the published result.
- **B:** the production order, where the call comes first and the published result follows.
- **C:** a Turn is in flight across the upgrade. The `tool_call` was stored by the old build and the `tool_call_update` comes from the new one. This leaves an orphan item stuck `in_progress`.

The triage asked one thing of the author: whether the harness `toolCallId` equals the binding's `modelCallId`. The code says yes. `hosted-workspace-tool-turn.ts` records `modelCallId: request.call.callId`, the model's function-call id, which is the same id the harness streams.

**Reachability today:** none. In the real hosted stack (Fig. 3, both arms identical), Workspace Sessions ran 12 tool executions but put no `item.tool_call.updated` on the public stream and made no publication. The unbound Session was offered 0 tools. So `HarnessEventProjector`'s tool branch is not reached yet, and neither are the collision this item fixes or the split it introduces. That is the reason to take the stable fix now. Leaving the callId branch as `turnId + ":" + callId`, which is `EventIdentity`'s version-1 rule, and moving only the no-id fallback keeps ids wire-stable and needs no projection-version decision.

![reachability]({{IMG3}})

### Operator-visible items (startup validation, rename 503, backoff)

![operability]({{IMG4}})

- **Backoff cap.** With `streak >= MAX_BACKOFF_STREAK`, the `streak < MAX` guard is false, so the target is attempted, and warned about, on every pass. Measured with the real `@Scheduled` materializer, warnings per second went `[5,1,0,1,0,0,5,10,9,10,…]`: 139 in 20 s against 196 on base, and the same 10/s steady state. To keep a gate at the cap, retry every `MAX` passes instead of falling through.
- **Rename cause.** To give on-call the root cause, log at the rename catch, for example `LOG.warn("Hosted Harness rename failed tenant={} session={}", …, error)`, or have `ApiExceptionHandler` log 5xx `ApiException`s that carry a cause.
- `MessageMaterializer.failures` is cleared only on success. I did not measure this one, but it is the same unbounded-map class the triage noted.

### Do the PR's tests catch reversions? (negative control and mutants)

{{MUTATION}}

### Candidate fix (local, not pushed)

{{FIX}}

### CI-parity gates on this head

- `mvn -Pmysql-integration clean verify checkstyle:check` against MariaDB 10.11.18 on x86_64 Linux: **736 unit + 52 MariaDB ITs, 0 failures**, Checkstyle 0, SpotBugs 0 (4 min 36 s).
- Full-stack hosted IT copy (`HostedPublicWorkspaceIT` flow plus an unbound Turn), real `qwen serve`: green on both arms.
- {{AARCH64}}
- GitHub CI on `c096be36`: every lane green, including `Hosted process fault gates / MySQL 8.4` and `Real daemon E2E`.

**Not verified:** the MySQL `hosted-harness-mysql` lane locally (CI is green on it), Windows and macOS (CI only), and the item-2 attach behaviour (it is #13403's code now).

Evidence (probes, logs, candidate diff, figures): [`asserts@{{SHORT}}/pr-13330`]({{TREE}})

<details>
<summary>中文说明</summary>

## 维护者验证 —— #13330 @ `c096be36`（真实环境）

**结论：现状不建议合入。** 多项改动成立，且每项改进都对照 base 复现过：归档/删除围栏（现在重启后仍有效）、连接器关闭竞态、base URL 与 lease/renew 的启动校验、kubernetes 文案，以及退避中"防饿死"的那一半。有一处问题阻塞合入：Stage-2 triage 评审指出的 close 路径围栏回归，我端到端复现了。另有一处建议在本 PR 内一并修：triage 指出的 id 分叉，用生产类复现了，只是目前还是潜伏的。还有两项目前没有运行时效果：rename 的 cause，以及退避中"告警洪水"的那一半。第 2 项已不在本 diff 中。两处修复都很小，我在本地打了一个两文件的候选补丁，所有探针和全量测试都通过（见下文）。

> 注：接管的 autofix 三轮都没有处理 Stage-2 的 `request changes`（第 1 轮解决合并冲突，第 2 轮重试 CI flake，第 3 轮报告"无可处理反馈"）。两条 Critical 在当前 head 上仍然存在。

**环境。** base 臂取 merge-base `3172c9fd`，两臂之间的生产代码差异恰好是 PR 的 9 个文件；PR 能干净合入当前 `main`（`69d5db2f`）。Java 跑在 CI 同款 `eclipse-temurin:21-jdk` 上，数据库用 H2 和 MariaDB `10.11.18`（MariaDB 镜像与 CI 相同）。全栈运行时，我用本 head 构建并 bundle 了 CLI（`pnpm install`、`build`、`bundle`），再把真实的 `qwen serve --profile hosted-harness` 与 Spring 服务、Session Store、内嵌 Runtime Broker 一起拉起。每个探针都驱动被测路径上的生产类，唯一的替身是模型，以及少数不在该路径上的协作者。

### 逐项结果

| # | 项 | 结果 | 证据 |
|---|---|---|---|
| 1a | ARCHIVED/DELETED 持久围栏 | ✅ 生效，且**重启后仍生效**。base 重启后会为已归档、已删除的会话 warm 出真实的 `READY` runtime binding | 图 1 |
| 1b | "close 仍保留进程内退休" | ❌ **相对 main 的回归**：同进程内，已关闭的非绑定会话会拉起真实 worker。`drain()` 读行时状态仍是 `CLOSING`，所以从不退休。即 triage Stage-2 Critical #2 | 图 1 |
| 2 | attach 抓取移出 `computeIfAbsent` | ⚠️ **已不在本 diff 中**：合并时被 main 上的 #13403 取代。`loadsOnceAcrossConcurrentFreeAttachCalls` 现在钉的是 #13403 的代码，在 base 上同样通过。PR 描述仍写着旧改动 | diff |
| 3 | 连接器关闭竞态 | ✅ | 变异体 m03/m04 被杀死 |
| 4 | 无 scheme 的 base URL | ✅ 真实服务启动即以清晰信息拒绝。base 能启动，首次 rename 才返回 503，且服务端零日志 | 图 4 |
| 5 | 工具项 id `:call:` 标记 | ⚠️ **潜伏分叉（用生产类复现了 triage Critical #1）**：工具调用被拆成两个 item，`GET /items/{call}/tool-result` 返回 404。但**当前 hosted 栈触达不到**（图 3），因此定为"应修"，而非线上已坏 | 图 2、3 |
| 6 | lease/renew 校验 | ✅ 真实服务启动即拒绝 | 图 4 |
| 7 | rename 503 挂 cause | ⚠️ **没有运行时效果**：`ApiExceptionHandler.api()` 从不记录 `ApiException`，harness 宕机时两臂服务端日志都是 **0 行** | 图 4 |
| 8 | 物化退避 | ✅ 饿死已修：33 个被污染会话时，健康事件 **181 ms** 内物化（base 15 秒内**始终没有**）。⚠️ 告警洪水**没修**：streak 到 64 上限（约 6.5 秒）后每轮都重新尝试并告警，回到 10 次/秒，与 base 相同 | 图 4 |
| 9 | kubernetes 拒绝文案 | ✅ | 图 4 |

### 发现 A（阻塞）：已关闭的非绑定会话不再被围栏拦截

我在 H2 文件库上拉起真实的 `ManagedAgentServerApplication`，每个会话分别走公共 API 的 `POST /close`、`/archive` 或 `DELETE`，然后调用 `EmbeddedRuntimeBroker.warm(sessionId)`——这正是 turn 派发时 `HarnessCoordinator.warmRuntime` 发出的调用。provisioner 用的是 `local-process`，所以一旦 warm 穿过围栏，就会拉起真实 worker（`qwen_runtime_binding` 变为 `READY`）。结果与静态追踪一致：`deliver()` 在 `completeOperation()` **之前**执行 `settle()` → `drain()`，此时行仍是 `CLOSING`，`drain()` 什么都不退休，而 resolver 只拦 ARCHIVED/DELETED。`drainStillRetiresAClosedSessionInProcess` 之所以绿，只是因为它把行 mock 成了 `CLOSED`，而那个时间点上行不可能处于该状态。

可达性有限：close 要求没有活动 turn，所以要触发这个回归需要 dispatch/close 竞态。但它仍是 main 已有、而本 PR 去掉的纵深防御；而且已关闭会话的重启缺口也仍然敞开，而补上这个缺口正是这一项的目的。

### 发现 B（建议在本 PR 内修）：工具项 id 规则的两份实现分叉

这个探针驱动生产类 `HarnessEventProjector`、`ManagedToolResultProjector`、`ManagedAgentStore` 和 `ManagedArtifactController`，作用在一条真实已提交的 shell 发布上。base 始终得到一个合并后的 item；head 在三种顺序下都会拆开：

- **A**：harness 的更新晚于已发布的结果到达。
- **B**：生产顺序，先有调用，后有发布的结果。
- **C**：turn 跨越升级。`tool_call` 由旧版本写入，`tool_call_update` 来自新版本，结果留下一个永远 `in_progress` 的孤儿 item。

triage 只请作者确认一件事：harness 的 `toolCallId` 是否等于发布绑定里的 `modelCallId`。代码给出的答案是相等：`hosted-workspace-tool-turn.ts` 记录的 `modelCallId: request.call.callId` 就是模型的 function-call id，也就是 harness 流出的那个 id。

**当前可达性：** 没有。在真实 hosted 栈里（图 3，两臂一致），Workspace 会话执行了 12 次工具，但公共事件流里没有任何 `item.tool_call.updated`，也没有任何发布；非绑定会话拿到的工具数为 0。所以 `HarnessEventProjector` 的工具分支尚未被触达——本项要修的冲突和它引入的分叉都还没有发生。正因如此，现在采用稳定修法最合适：callId 分支保持 `turnId + ":" + callId`（即 `EventIdentity` 的 v1 规则），只改无 id 的兜底分支。这样 id 在线上保持稳定，也不需要做 projection 版本决策。

### 运维可见项（启动校验、rename 503、退避）

- **退避上限。** 当 `streak >= MAX_BACKOFF_STREAK` 时，`streak < MAX` 不成立，目标在每一轮都会被尝试并告警。用真实 `@Scheduled` 物化器实测，每秒告警数依次为 `[5,1,0,1,0,0,5,10,9,10,…]`：20 秒共 139 次（base 196 次），稳态同为 10 次/秒。要在上限处保留门控，应改为每 `MAX` 轮重试一次，而不是直接放行。
- **rename 根因。** 要让 on-call 看到根因，应在 rename 的 catch 里记日志，例如 `LOG.warn("Hosted Harness rename failed tenant={} session={}", …, error)`；或者让 `ApiExceptionHandler` 记录带 cause 的 5xx `ApiException`。
- `MessageMaterializer.failures` 只在成功时清理。这一点我没有实测，但属于 triage 提到的同一类无界 map 问题。

### PR 的测试能否抓住回退？（负对照与变异）

{{MUTATION_ZH}}

### 候选修复（本地，未推送）

{{FIX_ZH}}

### 本 head 上的 CI 同款门禁

- x86_64 Linux 上对 MariaDB 10.11.18 执行 `mvn -Pmysql-integration clean verify checkstyle:check`：**736 个单测 + 52 个 MariaDB IT，0 失败**，Checkstyle 0，SpotBugs 0（4 分 36 秒）。
- 全栈 hosted IT 副本（`HostedPublicWorkspaceIT` 流程，外加一个非绑定会话 turn），使用真实 `qwen serve`：两臂均通过。
- {{AARCH64_ZH}}
- GitHub CI 在 `c096be36` 上全绿，包括 `Hosted process fault gates / MySQL 8.4` 和 `Real daemon E2E`。

**未验证：** 本地未跑 MySQL `hosted-harness-mysql` 车道（CI 上为绿）；Windows、macOS 仅有 CI 覆盖；第 2 项的 attach 行为（现在属于 #13403 的代码）。

证据（探针、日志、候选 diff、截图）：[`asserts@{{SHORT}}/pr-13330`]({{TREE}})

</details>

<sub>🤖 Generated with [Claude Code](https://claude.com/claude-code) — Claude Opus 5.5</sub>
