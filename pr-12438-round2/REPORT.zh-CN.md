## 维护者验证第 2 轮 — PR #12438 @ `4ba99cf59a`（相对第 1 轮的增量）

[第 1 轮](https://github.com/QwenLM/qwen-code/pull/12438#issuecomment-5771333776)验证的是 `054159f`。这一轮我用同一套环境重跑 `4ba99cf59a`：JDK 21、真实 MySQL 8.4、多个 Broker JVM。只报告有变化的部分：
- 第 1 轮的哪些问题已经关闭；
- 修复提交本身带来了什么。

`ea39fc189b` 是第 1 轮提交原样 rebase 而来（`git range-diff` 显示 `=`），所以真正的增量是 `4ba99cf59a`：6 个文件 +737/−80，大部分是测试。

**结论：**
- 发现 1 是我要求合入前修复的问题，已完全按建议修好。修复在内存、H2 和真实 MySQL 上都成立；同一套环境今天在 `054159f` 上仍能复现原缺陷（反向对照）。
- 同样已修复的还有：R1-2 的 dispatch 卡死路径、R1-18、R1-8，以及错误通道相关的 R1-3…R1-6。R1-7 推迟处理。
- **从我这边看可以合入。**

cancel 路径上还剩两个窄问题：
- 修复提交在 dispatch lease 失效后的 cancel 上引入了一个小回归；
- R1-2 的第三个症状仍未修复。

有一个经过测试的补丁可以同时修掉这两处：生产代码 +18/−1，另加两个测试。建议合入前或合入后马上采纳，但我不会因此阻塞合入。

![第 1 轮问题在 4ba99cf59a 上的状态](fig1-r1-closure.png)

### 已关闭的问题（同一套探针，两个 head 都跑过）

- **发现 1（1a + 1b）。** S1 各行全部通过。`RaceStress`（真实线程，无时序钩子）在所有后端都降到 0，两个 head 都是今天重跑的：
  - H2：重复供应轮数 80/3000 → 0/3000。
  - MySQL，读取后停顿 5 ms：189/200 → 0/200。不加停顿时两个 head 都是 0/1000，因为 `SELECT … FOR UPDATE` 让窗口变窄了。
  - 内存：每次运行最多 1/3000 轮重复供应、18–44 次 `runtime_reconciliation_required` 误报 → 0。

  你新增的两个测试都能杀死各自要钉住的守卫。
- **R1-2 的前两个症状，以及我第 1 轮补充的两条路径。**
  - S2/S2b 的六行最终都是已结算或 `UNKNOWN`。
  - 一次瞬时的 `renewDispatch` 异常不再丢掉 claim（R2-B）。
  - 续租任务会自行 fence 已失效的 claim，不必等调用方重试（R2-C）。
  - 我第 1 轮建议的 6 个测试在 `054159f` 上失败 5/6，在这里 6/6 通过。
- **R1-18。** 排在阻塞的 `execute()` 后面的 cancel 现在 0 ms 返回，并且发到了 Runtime。在 `054159f` 上它要等 2000 ms，而且始终没有发出。
- **R1-3…R1-6、R1-8。** 带码错误和关闭时的 fencing 都与描述一致，每一项都有测试能杀死对应的守卫。
- **R1-15。** 已被钉住。同时删掉 `requireExecution` 的两个 Session 检查（Harness 和 Runtime），`executionCannotCrossWorkspaceSessionOwnership` 会失败。只删其中一个时测试发现不了，因为两个检查互为兜底。
- **放宽重驱动后的同 key 并发。** 跑了 2000 轮，每轮在同一个 key 上并发 8 个 `createExecution` 和 2 个 `cancelExecution`，dispatch lease 分别取 1 h 和 15 ms。结果：物理执行重复 0 次，最后未结算的记录 0 条。

### `4ba99cf59a` 新引入：dispatch lease 失效后的 cancel（非阻塞，窗口很窄）

![lease 失效后的 cancel](fig2-cancel-after-lapse.png)

[`cancelExecution`](https://github.com/QwenLM/qwen-code/blob/4ba99cf59a53289f341fb43f1caa20802edec69a/packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java#L217-L229) 新增的分支把已过期的 `CANCEL_REQUESTED` 记录交给 `beginDispatch`，由 `claimDispatch` 去 fence。当 Tool 调用仍在本进程内运行时，这里会出问题：
1. `dispatches` 里还有这个调用，所以 `beginDispatch` 什么也不做就返回了。
2. 调用方拿到 `CANCEL_REQUESTED`，看起来像已受理。
3. `transport.cancel` 一次都没有被调用，重复 cancel 也一样。

在 `054159f` 上，同样的调用会发到 Runtime。

不会重复执行，记录最终也仍会被 fence 成 `UNKNOWN`：要么在下一次续租时，要么（如果调用先完成）在下一次同 key 调用时。丢掉的是物理取消信号，而这个调用 Broker 明知还在运行。

要触发这个问题，lease 必须在 owner 进程存活时失效，也就是续租延迟要接近整个 lease。在本切片里，例如：所有续租共用唯一的 `qwen-runtime-broker-lease-renewal` 线程，它被某个正在供应的 binding 的一次慢 JDBC `renewOperation` 卡住。将来若有持久化的 execution 仓储，仓储中断时间接近 lease 也会触发。

修复只需要加一个条件：仅当本进程没有在途 dispatch 时才 fence（`&& !dispatches.containsKey(executionId)`），否则走下面的物理 cancel。记录一旦是 `UNKNOWN`，两个 head 上的 cancel 都会直接返回，因为按设计 `UNKNOWN` 要等 reconciliation；补丁不改变这一点。

### 仍未修复：R1-2 的第三个症状

假设 claim 失效后 Runtime 回复 `state: settled`。cancel 仍然失败，返回 `409 runtime_execution_state_conflict`（`retryable=false`），记录停在 `CANCEL_REQUESTED`，直到之后某次调用把它 fence 掉。作者对 R1-2 的回复讲的是重试重驱动和 fencing，只覆盖了前两个症状。

补丁按 R1-2 的建议处理：
- 冲突来自已失效的 claim 时，`absorbCancellationStatus` 通过 `claimDispatch` fence，cancel 返回 `UNKNOWN`。
- 其他错误码，或者 claim 仍然有效时，原样重新抛出。

请两个 hunk 一起采纳：第一个 hunk 会让更多 lease 失效后的 cancel 发到 Runtime，这条路径因此更容易被触发。

两个新测试在 `4ba99cf59a` 上都失败，分别报 `expected: <1> but was: <0>` 和 409；打补丁后都通过。在 `eclipse-temurin:21-jdk` 里对 `4ba99cf59a` 全新 `git apply` 后，62/62 测试通过，Checkstyle 0 违规。第 1、2 轮的所有探针都保持全绿，只有下面的 R2-E 除外，补丁不涉及它。

### 门禁、真实 MySQL、逐条删除守卫

![门禁、MySQL、变异](fig3-gates-mysql-mutation.png)

- **门禁。**
  - `eclipse-temurin:21-jdk`（21.0.12）下，`mvn verify` 60/60，`mvn checkstyle:check` 0 违规。
  - `RuntimeBrokerServiceTest` 连续跑 20 次：20/20 全绿。
  - `4ba99cf59a` 的 CI：17 项通过、0 失败，包括 Java 11/17/21。
  - 根目录的 `pnpm` 构建和 typecheck 没有重跑：增量只涉及 Java 和文档，CI 的 Linux 测试和 lint 任务都是绿的。
- **MySQL 8.4 + 多个 Broker JVM（M1–M4）** 行为与第 1 轮完全一致：
  - 6 个 JVM 只发生一次物理供应；
  - 被 `SIGSTOP` 的 owner 被 fence；
  - `kill -9` 后被接管；
  - 同一 owner id 重启后 fail-closed。
- **逐条删除守卫，现在共 54 个：** 第 1 轮的 38 个，加上修复提交新增的 16 个。你的 34 个测试杀死 25 个；第 1 轮时 17 个测试杀死 10/38。

  新守卫中有 6 个在你的测试下存活：
  - N05（遇到瞬时异常时续租继续）和 N09（cancel 会 fence 已过期的 `CANCEL_REQUESTED`）：只有我的探针能发现。
  - N07（重试时 fence 已过期的 `EXECUTING`）：会被第 1 轮的 `resultAfterTheDispatchLeaseLapsedIsFencedAsUnknown` 杀死。
  - N15（dispatch 只执行 `DISPATCHING` 状态的 claim）和 N16（在 Session 锁内重新检查 `READY`）：没有任何手段能发现。
  - N10 是等价变异。

  第 1 轮提到的 M11（`requireSession` 的 Harness 检查）仍然没有被测试钉住；第 1 轮补丁里的 `anotherHarnessSessionCannotDriveARuntimeSession` 可以杀死它。

### 非阻塞，已有问题（不是 `4ba99cf59a` 引入的）

- **本轮首次报告：** `BindingRenewal` 仍把一次瞬时的 `renewOperation` 异常当作 claim 丢失。本次供应会被 fence，lease 过期后再重新供应一次（R2-E，provisioner 被调用两次）。因为 provisioner 必须收敛，这是安全的；但这次提交之后，它的行为与已改过的 `DispatchRenewal` 正好相反。
- 公共参数校验仍绕过带码通道。`harnessSessionId=""`、`idempotencyKey=""`、`executionCallId=""` 会同步抛出，非法的 `turnKind` 则让返回的 stage 失败。这些情况暴露给调用方的都是无类型的 `IllegalArgumentException`（triage 第 4 条；第 1 轮 S3）。
- 不拥有该 binding 的进程仍持续返回 `retryable=true` 的 `503 runtime_reconciliation_required`；M1 中每个进程重试 75–76 次后放弃（第 1 轮 M1/M4 的说明）。
- 把 R1-7（仓储异常未带码）放到单独的 PR 处理是合理的。

<details>
<summary>建议补丁（生产代码部分 +18/−1；2 个测试见 <code>suggested-fix-r2.patch</code>）</summary>

diff 与英文部分相同。两个测试加在 `RuntimeBrokerServiceTest` 中，都是确定性测试，不用 sleep：
- `cancellationAfterALapseStillReachesTheRunningInvocation`
- `settledCancellationAfterALapseIsFencedInsteadOfConflicting`

</details>

证据（图、第 2 轮探针 `R2Probe`/`ExecStress`、重新映射后的守卫删除脚本、全部日志、`suggested-fix-r2.patch`）：[`wenshao/qwen-code@asserts/pr-12438-round2`](https://github.com/wenshao/qwen-code/tree/asserts/pr-12438-round2)。
