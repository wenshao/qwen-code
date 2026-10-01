## 维护者验证：#13005 在 `42423a6562` 上的真实模型 A/B

**结论：可以合入。** 在真实模型下，PR 版测试 8 次运行全部通过。它把 `tool_search` → `tool_call` 桥接这一来回，以及托管记忆提取器，从该用例的关键路径上拿掉了：main 版测试有 4 级串行模型请求，PR 版只有 3 级。在每次请求都注入 +80 s 的供应商卡顿时，main 版测试在 300 s 处超时，PR 版 251 s 通过。squash 之前应先修正 PR 描述里一句过期的话（F1）。另有一个 PR 之前就存在的断言缺口，值得用 7 行代码做个后续加固（F3，可选）。

### 环境

- **代码树：** 当前 `main`（`0a5f518b4f`），在本地合入了 PR head。合并无冲突，相对 main 的唯一差异是 `integration-tests/cli/monitor.test.ts`（+10/−4）。只做了一次完整 build 和 bundle，所以**两组跑的是同一个 `dist/cli.js`**。两组之间唯一的区别是测试文件：一边是原样拷贝的 main 版 `monitor.test.ts`，一边是 PR 版。
- **模型：** `qwen3.8-max`，经 OpenAI 兼容的 DashScope 端点调用。环境变量与 E2E Linux `sandbox:none` 那条腿一致（`QWEN_SANDBOX=false CI=true KEEP_OUTPUT=true VERBOSE=true OPENAI_*`），`QWEN_HOME` 用空的隔离目录。我用 `--retry=0` 运行，好让每次尝试都可见；CI 用的是 `retry: 2`。
- **录制代理：** 在 CLI 和端点之间放了一个反向代理。它为每次模型请求记一行日志（用途、声明的工具、返回的工具调用、TTFT），还可以在转发前把请求固定扣住一段时间。它的计数我逐次和每轮的 `telemetry.log` 做了交叉核对。
- **规模：** 共 19 次 CLI 运行，100 次真实模型请求。

### 1. 正常延迟：每组 5 次，在同一供应商时间窗内成对运行

![Fig 1: request timelines, normal latency](fig1-normal-latency.png)

| `should call monitor tool` 用例 | main 版测试 | PR 版测试 |
|---|---|---|
| 结果 | 5/5 通过 | 5/5 通过 |
| 模型请求数 | 5–6 | 4 次为 3；1 次为 6（见 F2） |
| 第 1 个请求是否声明 `monitor` | 否：经 `tool_search` → `tool_call` 桥接才调到 | 是 |
| 记忆提取器请求 | 每次 1–2 个 | 0 |
| 耗时 | 20.3–26.6 s（中位数 23.9 s） | 12.1–34.3 s（中位数 19.8 s） |

正常延迟下，墙钟时间的差别落在供应商噪声范围内（有一次 PR 版运行慢，纯粹是生成耗时长）。结构性的差别在请求数。

### 2. 模拟供应商卡顿：每次请求前注入固定延迟

![Fig 2: request timelines with injected delay](fig2-injected-latency.png)

| 每次请求的延迟 | main 版测试 | PR 版测试 |
|---|---|---|
| +45 s（≈ PR 描述中的 44.7 s TTFT） | ✅ 193.5 s | ✅ 147.1 s |
| +60 s | ✅ 261.3 s | ✅ 195.9 s |
| +80 s | ❌ `Test timed out in 300000ms`，此时 drain 轮和提取器仍在途（telemetry：5 个 `api_request`、3 个 `api_response`） | ✅ 251.3 s |

![Fig 3: vitest output at +80 s per request](fig3-l80-vitest.png)

提取器在主轮结束时启动，与 drain 轮并行运行。所以 main 版测试是 4 级串行请求（`tool_search` → 桥接 → 最终回答 → drain ∥ 提取器），PR 版是 3 级。因此，导致 300 s 预算被击穿的单请求延迟，从约 70 s 提高到约 95 s。已经很慢的运行，会提前一整个请求的时间结束：+45 s 时早 46 s，+60 s 时早 65 s。

### 3. 其他检查

- **线上请求探针**（只录制的假服务器，结果确定）：用 PR 的设置时，第 1 个请求声明了含 `monitor` 在内的 15 个工具（main 是 14 个）。`monitor` 也不再出现在 deferred 工具提示里，之后也没有提取器请求。`tools.visible` 和 `memory.enableManagedAutoMemory: false` 都和 PR 描述的一样生效。
- **静态检查：** `eslint --max-warnings 0`、`prettier --check`、`tsc --noEmit -p integration-tests` 全部 exit 0。
- **#13002 之后 main 的 CI**（`main` 上的 E2E workflow，抽样 22 次运行中的 43 份 job 日志，2026-09-30 04:21Z → 2026-10-01 09:29Z）：`should call monitor tool` 每次都通过，没有重试。最大耗时为 `sandbox:docker` 138.7 s（p50 73.7 s）、macOS 122.0 s、`sandbox:none` 62.7 s。所以这个测试目前在 main 上并不红；#13002 的 180 s / 300 s 预算已经把 flake 吸收掉了。本 PR 带来的是余量、更短的运行时间和更少的计费请求，而不是修一个当前就在失败的测试，这仍然值得合入。多出来的余量对 docker 那条腿最有意义，该用例在那里已经跑到 138.7 s。

### 发现

**F1：PR 描述已过期，建议在 squash 前修正。**
- "raises the budget to a 180s test timeout with an explicit 120s waitForToolCall" 描述的是 autofix 第 1 轮合入 main 之前的分支。当前 diff 没有改任何超时：它保留了 main 的 `waitForToolCall('monitor', 180_000)` 和 300 s 配置默认值，这正是 triage 评审要求的结果。
- "five sequential model requests" 也不太准确。提取器与 drain 轮是重叠的，所以 main 的路径是 4 级串行请求。只有当提取器需要第二轮时才是 5 级，这在 5 次正常延迟运行中出现了 2 次。

**F2："三次模型调用"是典型情况，并非保证。无需处理。**
- `tools.visible` 让发现这一步变得不必要，但并不禁止它。在用 PR 设置的 9 次真实运行里，有 1 次模型仍然去搜索了：先搜 `monitor` 关键词，再搜一个关键词短语，然后是 `select:monitor`。
- 接着它尝试 `tool_call` 桥接，得到 `[tool_call bridge refused] Tool "monitor" is already visible to the model or is not deferred. Call it directly instead of using tool_call.`，之后才直接调用 `monitor`。
- 这次运行共 6 个请求、34.3 s，仍然通过。探针表明这是模型自己的选择，不是设置有漏洞。桥接的拒绝路径在这里也工作正常。

**F3：测试会接受一个运行时失败的 monitor。这是 PR 之前就存在的问题，修正可以作为可选的后续工作。**
- PR 描述说 "a regression in monitor tool behavior still fails the test"，这只说对了一部分。
- 我构造了一个变异体，让 `monitor.execute()` 每次都返回错误（`spawn EACCES`）。PR 版测试对它**仍然通过**（41.4 s），模型自己都回复了 "the monitor tool never started"。
- 能通过的原因：`waitForToolCall` 只按工具名匹配（telemetry 记录里是 `success: false`），`validateModelOutput` 只要求输出非空。main 上的断言完全相同，所以不是这个 PR 引入的。
- 在 `expect(foundMonitor).toBeTruthy()` 之后加上下面这段，可以杀死该变异体，并且在干净的真实运行上仍然通过（14.0 s）：

```ts
// A logged call is not a working tool: also require that it succeeded.
const monitorCalls = rig
  .readToolLogs()
  .filter((log) => log.toolRequest.name === 'monitor');
expect(
  monitorCalls.some((log) => log.toolRequest.success === true),
  `monitor call did not succeed: ${JSON.stringify(monitorCalls)}`,
).toBe(true);
```

![Fig 4: mutant monitor that always fails](fig4-mutant-monitor-fails.png)

**F4：桥接覆盖的损失（triage 留给人裁定的那一点）可以接受。**
- main 版测试确实是经 `tool_search` + `tool_call` 调到 `monitor` 的（telemetry 记录的是内层工具名）。PR 版不再走这条路。
- 仍然保留的覆盖：同文件的兄弟用例 `should have monitor tool registered` 依旧在 `monitor` 处于 deferred 状态下运行。该用例的 8 次运行里 `monitor` 都没有被声明，其中 6 次模型为它调用了 `tool_search`。
- 此外，`cli/tool-search.test.ts` 用真实模型保留了通用桥接的覆盖（`select:` → 调用、关键词搜索、功能开关关闭）。
- 桥接机制本身是通用的，放弃 monitor 专属的这条路径，换来一个不再 flaky 的测试，是值得的。

**F5：提取器与兄弟用例（仅为观察）。**
- 托管记忆提取器即使在没有任何工具活动的轮次上也会触发。我在两组的兄弟用例里都看到了，在假服务器上也是如此。这回答了评审 5364331497 留下的那个开放问题。
- 兄弟用例仍然带着提取器。但它很短（本地 11.7–19.1 s，main CI 上最长 127.4 s），远在 300 s 默认值以内，无需改动。

<details>
<summary>证据与复现</summary>

- 图片、每次运行的代理日志与 vitest 输出、由 telemetry 导出的汇总、CI 普查数据，以及 harness 脚本：本目录
- `harness/run-arm.sh <base|pr|hard> <inject_ms> <run_id> ["should call monitor tool"]` 运行其中一组。需要在 `UPSTREAM` 中给出 OpenAI 兼容端点，并在 `UPSTREAM_KEY` 中给出其 key。设置 `MUT_SHIM=<含 qwen shim 的目录>` 后，会经由 `INTEGRATION_TEST_USE_INSTALLED_GEMINI` 让 rig 改用变异后的 bundle。
- 变异体 M2 是对打包后 `monitor` chunk 的一行修改：`async execute(_signal){` → `async execute(_signal){return{llmContent:"Error: monitor failed to start: spawn EACCES",returnDisplay:"Monitor failed to start.",error:{message:"spawn EACCES"}};`
- 本次验证的真实模型总用量：100 次请求，约 1.95 M 输入 tokens。

</details>
