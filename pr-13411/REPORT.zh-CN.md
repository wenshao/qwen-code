## 维护者验证：#13411 @ `3a2e57e`

**结论：可以合并。**

- main 上失败的断言（`:3388:43`，`hasActivePrompt`）正位于本 PR 放宽的那一个 `waitFor` 内部，此外没有任何改动。
- 我在本地用真实的 CPU 饥饿条件复现了 main CI 的失败特征，使用的是**未经修改**的合并基点测试文件；同样条件下，PR 的测试文件通过。能覆盖 CI 那次负载突发的饥饿档位是 10 %、7 %、5 % CPU：在这三档里，base 31 次尝试挂了 27 次，head 12 次尝试 0 次失败。
- 检查本身没有被削弱：Turn 永远不落账时，head 仍会在约 10.07 s 处以同一条 `AssertionError` 失败，而不是报测试超时。
- `main` 目前仍停在 `9915c7ff8f`，它既是本 PR 的合并基点，也是触发 #13408 的那次 CI 所在提交。因此 head 本身就是合入后的代码树。

### 1. main 上挂的是哪条断言

作业 `111500825774`（运行 37222299287，runner `ecs-qwen-hk4-26`，开启覆盖率）。三次尝试（`--retry=2`）全部挂在本 PR 修改的那个 `waitFor`：

```
 × Hosted Harness no-tool session > refuses a cold load when a settled file tool outcome is missing from its checkpoint 5441ms (retry x2)
   → expected true to be false // Object.is equality
   → ENOTEMPTY: directory not empty, rmdir '…/hosted-harness-test-9sqhKw/resources/22222222-…'
   → expected true to be false // Object.is equality
   → ENOTEMPTY: directory not empty, rmdir '…/hosted-harness-test-NOMYYa/resources/22222222-…/managed-tool-outcome'
   → expected true to be false // Object.is equality

 ❯ src/serve/hosted-harness-session.test.ts:3388:43
    3388|       expect(status.body.hasActivePrompt).toBe(false);
```

`ENOTEMPTY` 是副作用：`afterEach` 删除临时根目录时，Turn 还在写 `managed-tool-outcome`，说明 Turn 只是慢，并没有卡死。作业的 `DFSAMPLE` 行显示，这个文件运行期间（18:30:52–18:33:19）宿主机 1 分钟负载从约 10 升到 36，文件出结果时仍在 30 左右。

### 2. main CI 普查（图 1）

我收集了该测试随 #13088（`afb911a3c8`，2026-09-30）落地以来 main 上的全部 `Test (ubuntu-latest, Node 22.x)` 作业，共 81 个，截至 2026-10-04 那次失败运行。

- 该测试通过 80 次：其中 60 次耗时不足 300 ms（vitest 不列出），其余 20 次为 301–1,532 ms。没有一次靠重试才通过。
- 只失败过 1 次，就是触发 #13408 的那次。
- 那次运行中整个文件耗时 147 s，而 81 个作业的中位数是 42 s。目标测试前后的 10 个测试，在其余 80 次运行中至少 77 次都不足 300 ms，这次却每个都花了 1.4–3.2 s。这是 runner 负载突发，而不是这条代码路径的问题。

![main CI 普查](./01-main-ci-census.png)

### 3. 真实 CPU 饥饿，测试文件不做任何修改（图 2、图 3）

**装置**（与我验证 #13323 时的方法相同）：
- **两臂。** 两臂共用 PR head 的同一份构建。base 臂取合并基点上该测试文件的 blob（`5c861137`，即本 PR diff 的前像），存成未跟踪的兄弟文件 `hosted-harness-session.armbase.test.ts`；head 臂就是 PR 自己的文件。两臂都没有改动任何源码或测试代码。
- **main CI 配置。** 每次运行都使用 `CI=true QWEN_CI_COVERAGE=1`、`ecs-qwen-*` 形式的 `RUNNER_NAME`（测试与 hook 超时均为 60 s，`maxWorkers` 25 %）、`--retry=2`，以及 `-t 'settled file tool outcome is missing'`。
- **限流。** 每次运行都在一个临时 `systemd-run --scope` 内执行。监视器盯着私有的 `TMPDIR`：测试的 `beforeEach` 一建出 `mkdtemp` 目录，就用 `systemctl set-property` 施加 CPU 配额；vitest 打印出文件结果时再解除。因此 collect 阶段不受限，被饿着的只有测试体本身。

| CPU 配额 | 落账耗时 p50（范围） | base 失败尝试 | head 失败尝试 |
|---|---|---|---|
| 不限 | 53 ms（33–68） | 通过 | 通过 |
| 10 % | 1.0 s（0.85–1.9） | 3 / 7（全部被重试吸收，4 次运行 0 次红） | **0 / 4** |
| 7 % | 1.7 s（1.4–2.9） | **12 / 12**（4 次运行全红） | **0 / 4** |
| 5 % | 2.1 s（1.8–6.1） | **12 / 12**（4 次运行全红） | **0 / 4** |
| 3 % | 5.4 s（3.0–13.1） | 12 / 12（4 次运行全红） | 6 / 9（4 次运行 1 次红） |
| 2 % | 10.1 s（6.6–42.5） | 未跑 | 未跑 |

A/B 每格 4 轮，base 与 head 并发运行。两臂的每次失败尝试都是 `hasActivePrompt` 那一行上的 `expected true to be false`；在 5 % 和 3 % 档，base 还会附带次生的 `ENOTEMPTY` 清理错误。两者合起来就是 CI 上的失败特征。落账耗时来自单独的探针臂：在 PR 文件里、未改动的 `waitFor` 之前插入计时器，从 POST prompt 起每 10 ms 轮询一次，直到 `/status` 首次显示已落账（空载 n = 30，每档配额 n = 8）。

**与 CI 突发校准。** 我在 10 %、7 %、5 % 三档下跑了相同的邻近测试，与它们在那次失败 CI 中的耗时对比：

| 测试（单次尝试） | CI 突发 | 本地 10 % | 本地 7 % | 本地 5 % |
|---|---|---|---|---|
| refuses a workspace cold load before another input… | 1,543 ms | 1,389 | 2,300 | 红（见备注 3） |
| refuses a cold load when a complete empty Shell stream loses its seal | 2,720 ms | 904 | 1,199 | 1,694 |
| distinguishes strict create and load outcomes | 2,110 ms | 610 | 900 | 3,398 |
| closes the Shell publisher after a completed turn | 1,397 ms | 3,350 | 5,422 | 7,882 |

可见那次 CI 突发落在 10–5 % 这一区间。在这个区间里，旧的 1 s 窗口 31 次尝试挂了 27 次，10 s 窗口一次没挂；我在其中测到的最慢落账耗时是 6.1 s。

![真实争用 A/B](./02-real-contention-ab.png)

### 4. 确定性延迟阶梯与反向对照（图 3 右）

用同样的两臂，但不限流，而是把 Turn 唯一的那次模型调用延迟 D ms，两臂注入完全相同。使用本地配置：`testTimeout` 15 s，不重试，不开覆盖率。

- **base** 从 D = 1,200 ms 起就失败，每次都在约 1.07 s 处。
- **head** 一直通过到 D = 9,000 ms。
- **head** 在 D = 11,000 ms 时失败，模型调用永不返回（`hang`）时也失败。两者都在约 10.07 s 处以 `hasActivePrompt` 那一行上的 `AssertionError: expected true to be false`（`vi.waitFor.timeout`）失败，而不是 `Test timed out`。

放宽后的窗口报出的仍是真实断言。这也复现了作者 1.2 s 探针的结果。

![落账耗时、A/B 矩阵与延迟阶梯](./03-settle-ab-ladder.png)

### 5. 其他检查

- **diff。** 改动只有调用被重新换行，以及新增的 `{ timeout: 10_000 }`。两行 `expect` 逐字节一致。按 AST 计数，使用默认超时的 `vi.waitFor` 从 46 个变为 45 个，去掉的正是 `:3384`。
- **head 上整文件运行。** 本地默认配置 188/188 通过；main CI 配置（覆盖率、`--retry=2`、`ecs-qwen-*`）下同样 188/188 通过。
- **Lint。** 对该文件运行 `prettier --check` 与 `eslint --max-warnings 0`，均干净。
- **PR CI。** 30 个成功、48 个跳过、0 个失败（check-runs 已分页拉全）。PR 运行中 `QWEN_CI_COVERAGE` 为空，即不开覆盖率，所以 PR CI 全绿并不能检验这个 flake。这也是我搭本地装置的原因。

### 非阻塞备注

1. **triage 对超时余量的估算把累计时长当成了单次尝试。** CI 日志里的 5,441 ms 是三次尝试的累计值：vitest 3.2.7 的 `runTest` 在重试循环之前取 `start`，循环结束后才写 `result.duration`（`@vitest/runner/dist/chunk-hooks.js` 第 1543 行与第 1649 行）。每次尝试约 1.8 s，其中包含 1 s 的窗口，所以测试到达 `waitFor` 只用了约 0.8 s 甚至更少，而不是约 4.4 s。在 15 s 上限的非 ECS runner 上，真实挂死仍会在约 11 s 时以断言报出。而且 main CI 跑在 `ecs-qwen-*` 上，上限本来就是 60 s。
2. **10 s 的余量是有限的。** 在 3 % CPU 下（比观测到的突发更重：落账 p50 为 5.4 s，5 % 档为 2.1 s），head 4 次运行中红了 1 次（9 次尝试挂 6 次），失败特征完全相同。在同一配额下，这个 Turn 的落账比 #13323 里 Hook fence 那个 Turn 慢约 2 倍（5 % 档 p50 2.1 s 对 1.0 s）。10 s 是该文件的惯例值，在这里够用。
3. **下一个会挂的就是紧挨着的上一个测试。** `refuses a workspace cold load before another input when a committed resource is missing` 中的 `:3293` 形状完全相同，仍在用 1 s 默认值。在 head 文件上，它在 4 % CPU 下 3 次运行全红，5 % 下 5 次红 2 次（另外 3 次靠重试才过），7–10 % 下 6 次全过。失败特征一致：`hasActivePrompt` 的 AssertionError 加上清理竞态（图 4）。在触发 #13408 的那次 CI 中它耗时 1,543 ms，通过了。整个 `Hosted Harness no-tool session` 块里还有 43 个 `waitFor` 用默认超时（全文件 78 个中有 45 个）。triage 提到的 describe 级辅助函数（`Hosted Harness tool approvals` 块，第 5436 行）可以一次性收掉它们。这需要单独决定，不必阻塞本 PR。

![下一个同类 flake](./04-next-sibling-flake.png)

**证据。** 测试装置、原始数据和图表见 本目录（`harness/`、`data/`；A/B、校准、邻近测试与整文件运行的原始日志在 `data/raw-logs.tar.gz`），包括两臂生成脚本、限流运行器、A/B 与阶梯脚本、81 个作业的 CI 普查 TSV、全部 A/B 与阶梯日志，以及探针 JSONL。
