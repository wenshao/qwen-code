## 维护者验证：#13399 @ `a0dce616`

**结论：可以合入。** 风险低，收益有限。合入前建议改两处措辞：代码注释，以及 PR 标题和描述。

- **这个 PR 现在实际改了什么。** #13380 已合入 main（`a6a4b0ba`，2026-10-04 17:51Z），已经给 `requested()` 加上了显式的 `{ timeout: 5_000 }`。autofix 合并 main 之后，本 PR 相对 main 的全部 diff 是 `5_000 → 10_000` 加三行注释。我验证的是这个 5 秒 → 10 秒的增量，而不是最初的 1 秒 → 10 秒。
- **5 秒已经覆盖了 main CI 至今出现过的情况。** 我普查了 60 个合入后的 ubuntu Test job：
  - 除了两个被旧的 1 秒期限截断的偶发失败，没有任何审批类测试的总耗时超过 2.1 秒。紧挨着那次失败的最慢测试是 3.7 秒。
  - 平均而言，那次失败运行的 CPU 饥饿程度比我的 5% CPU 条件还轻。
- **10 秒为更重的争用留出余量。**
  - 1% CPU、测试文件不做任何修改时，main 的 5 秒 4 次运行全部失败（12 次尝试全败），本 PR 4 次全过。
  - 在 #13397 的确切窗口里注入确定性的 6–9 秒停顿，5 秒失败，10 秒通过。
- **检查没有被削弱。** 没有改动任何断言行。检查点一直不提交的轮次，仍然在 10.06 秒以同一个 `AssertionError` 失败，而不是测试超时。这远低于本地 15 秒、ECS 60 秒的单测试上限。所有 `requested()` 的调用方都使用 60 秒的审批过期时间，所以更长的等待不会撞上过期。
- **符合既有惯例。** 在 PR head 上，serve 测试里有 50 处 `timeout: 10_000`，分布在 10 个文件中；`5_000` 只有 2 处。为 #13408 修复、于 2026-10-05 00:13Z 合入的 #13411 也选了 `10_000`。
- **验证期间 main 前进了。** main 现在是 `35afa6f7`，唯一的新提交是 #13411，只改了 `hosted-harness-session.test.ts`。与本 PR 做 `git merge-tree` 无冲突，下文结论都无需重跑。

此前的协调：我在 #13380 的报告里建议两处改动只合入一处，最好是本 PR 这处。#13380 带着它的 5 秒先合入，随后 autofix 解决冲突时保留了 10 秒。两者现在是叠加关系，不再冲突。

### 1. main 上实际失败的是什么，以及新注释指向了哪里

Job `111443483838`（run 37204740344，`6694f354`，runner `ecs-qwen-hk4-24`）三次尝试都失败在检查点断言上，而不是长度断言。该文件运行期间（13:19:37–13:21:51Z），job 的 `DFSAMPLE` 行显示宿主机 1 分钟负载从 30 升到 37，`hosttests` 为 21–31：

```
 × reports an answer that loses the race to the expiry as expired 7086ms (retry x2)
   → expected 'before_model' to be 'await_action' // Object.is equality   (×3)
 ❯ src/serve/hosted-workspace-tool-turn.test.ts:1833:53
```

`commitDurableWait()`（`packages/core/src/managed-runtime/managed-harness-factory.ts:362`）先提交 `requestToolAction`，Action 由此可见且处于 `requested`；然后才提交 `await_action` 检查点。#13397 正落在这两次提交之间。

新注释说这些 fsync 写入发生在"Action 请求出现之前"，会把下一位读者引向错误的窗口，triage stage 3 也指出了这一点。§3 的延迟注入正是瞄准这个窗口，并逐字复现了 CI 的断言。

### 2. main CI 普查（图 3）

我覆盖了 main 上 2026-10-02 01:05Z 至 10-04 18:25Z 的全部 `Test (ubuntu-latest, Node 22.x)` job：共 60 个，都开启了覆盖率并使用 `--retry=2`。

- **58 个干净。** 其中调用 `requested()` 的最慢测试总耗时不超过 2.1 秒。反复出现的 1.05 秒来自一个自带 1 秒等待的测试。
- **1 次失败**，即上文的 #13397。
- **1 次被重试吸收的偶发失败。** 在 `71fefc75`（10-04 07:05Z），`writes nothing when the Session blocks while the expiry waits in the queue` 经 `retry x2` 才通过，耗时 10.7 秒。该测试既有 `requested()`，也有第二个裸 `vi.waitFor`（见 §5），日志无法判断是哪一个触发的。
- **#13380 合入之后：** 2 个 job，本文件都是绿的。`9915c7ff` 上那个红色 job 是另一个文件，即 #13408，已由 #13411 修复。

校准方法：把失败 job 中通过的 33 个审批类测试的单测耗时，除以同样测试在本地的耗时。中位比值在 5% CPU 时为 0.63，3% 时为 0.35，2% 时为 0.21。也就是说，那次运行平均比我的 5% 条件还轻，只是失败的那个测试恰好碰上了一次突发。

![Main CI census](./03-main-ci-census.png)

### 3. 在失败窗口中注入确定性停顿（图 1A 与图 4）

**对照组。** 所有对照组共用 PR head 的同一次构建。每组都是测试文件的一个未跟踪同级副本：

- **1 秒：** #13380 之前的原样 blob（`a6a4b0ba^`）。
- **5 秒：** main 上的原样 blob。
- **10 秒：** PR 的文件。

**注入。** 三组都对 `session.authority.requestToolAction` 加了同一个一次性包装：等真实提交完成后再停顿 D 毫秒，之后 `commitDurableWait` 才继续去提交检查点。运行使用本地配置，不重试，关闭覆盖率。

| 停顿 D | 1 秒（#13380 之前） | 5 秒（main） | 10 秒（本 PR） |
|---|---|---|---|
| 0 / 0.8 秒 | ✓ | ✓ | ✓ |
| 2 秒 / 4 秒 | ✕ 于 1.04 秒 | ✓ | ✓ |
| 6 秒 / 9 秒 | ✕ | ✕ 于 5.04 秒 | ✓ 6.11 / 9.09 秒 |
| 11 秒 | ✕ | ✕ | ✕ 于 10.05 秒 |
| 永不提交（挂起） | ✕ 于 1.06 秒 | ✕ 于 5.04 秒 | ✕ 于 10.06 秒 |

每个 ✕ 都是来自 `vi.waitFor.timeout` 的 `AssertionError: expected 'before_model' to be 'await_action'`，与 #13397 的文本一致。1 秒组的失败位置与 CI 日志同为 `:1833:53`。挂起的轮次在每一组里都会及时失败。

![Ladder and contention](./01-ladder-and-contention.png)

![Real vitest output](./04-terminal-ladder.png)

### 4. 测试文件不做修改，施加真实 CPU 饥饿（图 1B 与图 2）

**环境。**
- **配置：** 与 main CI 相同：`CI=true QWEN_CI_COVERAGE=1`，`ecs-qwen-*` 形式的 `RUNNER_NAME`（测试与 hook 超时均为 60 秒），以及 `--retry=2`。
- **限流：** 每次运行都在一个临时的 `systemd-run --scope` 里执行。第一个被选中测试的 `beforeEach` 创建 `mkdtemp` 目录时施加 `CPUQuota`，因此收集阶段不受限流；vitest 打印文件结果时解除。
- **轮次：** 共 4 轮。每轮把 12 个"对照组 × 配额"单元并行运行，宿主机噪声对每组的影响相同。

| CPU 配额 | 1 秒：失败运行（失败尝试） | 5 秒（main） | 10 秒（本 PR） |
|---|---|---|---|
| 3% | 1/4（12 次中 9 次） | 0/4（4 次中 0 次） | 0/4（4 次中 0 次） |
| 2% | 4/4（12 次中 12 次） | 0/4（4 次中 0 次） | 0/4（4 次中 0 次） |
| 1.5% | 4/4（12 次中 12 次） | 0/4（5 次中 1 次） | 0/4（4 次中 0 次） |
| 1% | 4/4（12 次中 12 次） | **4/4（12 次中 12 次）** | **0/4（7 次中 3 次）** |

另有一个探针组，记录文件中 34 次 `requested()` 调用各自需要等多久：直到 Action 处于 `requested` **并且**检查点读到 `await_action`，与 `vi.waitFor` 一样每 50 毫秒轮询一次。

| 条件 | 等待中位数 | 最长等待 | 超过 5 秒 / 10 秒的调用（共 34） |
|---|---|---|---|
| 空闲 | 0.05 秒 | 0.2 秒 | 0 / 0 |
| 3% CPU | 0.75 秒 | 4.8 秒 | 0 / 0 |
| 2% CPU | 1.05 秒 | 4.2 秒 | 0 / 0 |
| 1.5% CPU | 2.0 秒 | 9.8 秒 | 2 / 0 |
| 1% CPU | 3.4 秒 | 14.3 秒 | 4 / 3 |

所以 5 秒大约在 1.5% CPU 开始失守。在那个条件下，审批类测试比失败 CI job 中慢约 7 倍（校准比值 0.14，见 §2）。10 秒能多撑一段，但同样有上限：1% 时 34 次调用中失败 3 次。

![Settle time vs CPU](./02-settle-vs-cpu.png)

### 5. 同一文件中的残留问题（后续跟进，不属于本 PR）

`writes nothing when the Session blocks while the %s waits in the queue` 在 `:2852` 仍有一个裸 `vi.waitFor(() => expect(queued).toHaveBeenCalled())`，使用 1 秒默认值。`resolveHostedAction` 在调用 `authority.resolveAction` 之前，要先读取 options 资源并发布决定，后者是一次 fsync 写入。

在 PR head 上，不修改文件、不重试，我在 1% 和 1.5% CPU 下各跑了 10 次，在 2% 和 3% 下各跑了 4 次。结果：
- **1% CPU：** `:2852` 失败 2 次，报 `expected "resolveAction" to be called at least once`。`requested()` 即使是 10 秒也失败了 2 次。
- **1.5% CPU：** `:2852` 没有失败；`requested()` 失败 2 次。
- **2% 和 3% CPU：** 没有任何失败。

普查中被 `retry x2` 吸收的那次，正是这个 `it.each` 的 `expiry` 用例。它只在 10 秒本身也开始失守的深度才会出现，所以不阻塞本 PR。但它是下一个候选，机制与 #13397/#13408/#13316 相同。triage 提出的在 `test-setup.ts` 中为 CI 统一设置 `vi.waitFor` 默认值，可以一并覆盖它。

### 6. 其他检查

- **未修改的文件：** 在 PR head 上，本地配置与带覆盖率的 main CI 配置下都是 146/146。1 秒组和 5 秒组的副本在 main CI 配置下也都是 146/146。
- **lint 与格式：** 改动文件的 `eslint --max-warnings 0` 和 `prettier --check` 均通过。
- **PR CI：** `a0dce616` 上全绿，包括 `Test (ubuntu-latest, Node 22.x)`、`Lint & Static` 和 `Serve A/B`。PR CI 不开覆盖率，因此无法可靠地暴露这类偶发失败。

### 合入前建议（非阻塞）

1. **改写注释**，写明真正输掉竞争的窗口，例如：
   ```ts
   // The Action request commits first and its await_action checkpoint after
   // it, each behind fsynced durable writes; on the coverage-enabled, shared
   // post-merge CI runners the checkpoint lost vitest's 1s default (#13397).
   ```
2. **修改标题和描述。** 标题和正文仍在描述"替换 1 秒默认值"，而这已由 #13380 完成，squash 提交会错误描述这次改动。更准确的标题是 `test(cli): raise the hosted tool-turn requested() waitFor timeout to 10s (#13397)`，并用一句话说明 #13380 已设为 5 秒。
3. **关闭 #13397。** `Fixes #13397` 会在合入时关闭该 issue。如果改为以"已被取代"为由关闭本 PR，需要手动关闭 #13397。
4. **后续跟进：** §5 中 `:2852` 的裸等待，或者 CI 统一默认值。

**证据**（脚本、原始数据、图表、普查 job 清单）：this directory
