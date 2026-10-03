## 维护者验证：在 `28eaa47` 上用本地环境做真实 CLI A/B

**结论：可以合并。** 我从源码重新构建了 merge-base 与 PR head 两个版本，用真实打包的 CLI 对接同一个脚本化 provider。PR 声称的行为全部复现，包括本 PR 动机所在的默认配置场景。我专门检查的两类回归（主会话重试、普通 `Agent` 工具子 agent）都没有出现。把行为回退后，PR 新增测试中恰好 42 个变红。下面有一条非阻塞的补测建议。

### 验证环境
- 在 Linux、Node 22.22.2 上从源码构建两个版本（`npm run build && npm run bundle`）：**Base** 为 merge-base `1a4de74`，**PR** 为 `28eaa47`。PR 包里有 PR 自己新增的字符串（`Agent time limit reached during a retry wait.`），base 包里没有。
- CLI 以 `node dist/cli.js -p … --approval-mode yolo --auth-type openai` 运行，对接一个手写的本地 OpenAI 兼容 provider。provider 按脚本应答每个 workflow 子 agent 请求：可以返回带 `Retry-After` 的 HTTP 429、在 200 SSE 流里带 `error_finish` 限流、永不应答，或正常回复。主模型调用 `workflow` 工具，传入内联脚本（`agent(prompt, { stallMs })` / `parallel()`）。
- 派发次数用三种独立方式统计，每次运行三者都一致：
  - provider 的请求日志；
  - CLI 自身的 debug 日志（`[WORKFLOW_STALL] … stalled (attempt n/3) — retrying.`）；
  - subagent transcript 里的 `agent_retry` 标记。
- 共 64 次 CLI 运行，四个核心场景每个版本各跑 6 次，请求模式完全一致。

![请求时间线，Base vs PR，stallMs 500](fig1-timeline-ab.png)

### 结果

| # | 场景 | Base `1a4de74` | PR `28eaa47` |
| :-- | :-- | :-- | :-- |
| ① | 429 + `Retry-After: 2` → 200，`stallMs` 500 | 2 次派发：在 2s 等待中第 468–476ms 被重新派发 | **1 次派发**，+2010ms 重试（6/6） |
| ② | 429 + `Retry-After: 2` → 永不应答的请求 → 200 | 3 次派发 | **2 次派发**，挂起请求在开始后 498–499ms 被中止（6/6） |
| ③ | `parallel()`：A 收到 429 + `Retry-After: 2`，B 挂起一次 | A 2，B 2 | **A 1，B 2**：A 的等待不会屏蔽 B（6/6） |
| ④ | 流式限流（200 流里的 `error_finish` "429 Throttling"，即 `llm-chat` 的 `delay()` 路径），`retryInitialDelayMs` 2s | 2 次派发 | **1 次派发**（6/6） |
| ⑤ | **全部默认**：不设 `stallMs`、不覆盖生成参数；两次流式限流，于是 60s → 120s 退避撞上 180s 窗口 | watchdog 在 179.96s 触发，比 120s 休眠结束早 48ms，随后重新派发 | **1 次派发** |
| ⑥ | 429 + `Retry-After: 600`，`QWEN_CODE_WORKFLOW_AGENT_MAX_MINUTES=1` | 3 次派发全部 "stalled"，1.5s 后 `agent()` 返回 `null` | **1 次派发**，只发 1 个请求，60.0s 时 `terminate mode: TIMEOUT`（2/2） |
| ⑦ | 在 30s `Retry-After` 的第 300ms 发 SIGINT | 38ms 后 exit 130，无后续请求 | 43ms 后 exit 130，无后续请求 |
| ⑧ | 在 30s `Retry-After` 的第 3s 发 SIGINT | 没等到 SIGINT 运行就结束了：3 次尝试在 1.5s 内全部 stall，exit 0，`agent()` = `null` | 47ms 后 exit 130，总共 1 个请求 |
| ⑨ | 回归检查：主会话收到 429 + `Retry-After: 2`（未安装 observer） | 2.78s 后得到回答 | 相同（2.79s） |
| ⑩ | 回归检查：普通 `Agent` 工具子 agent（未开启选项）收到 429 + `Retry-After: 2` | 429，+2.0s 后 200 | 相同 |
| ⑪ | 已知缺口：SDK 默认重试（3 次 429 + `Retry-After: 2`，`stallMs` 5s） | 1 次 stall | 1 次 stall：与 PR 的 Risk & Scope 所述一致 |

![默认 180s 窗口与等待期间的时限](fig2-default-ladder-and-time-limit.png)

![CLI 证据，Base vs PR](fig3-cli-evidence.png)

**说明**
- ④ 和 ⑤ 覆盖了 PR 自身端到端测试走不到的路径。测试计划设置了 `model.generationConfig.maxRetries: 0`，而在 `llm-chat.ts` 里同一字段也限制流式限流重试次数（`maxRateLimitRetries = cgConfig?.maxRetries ?? RATE_LIMIT_RETRY_OPTIONS.maxRetries`）。设为 0 时，60/120/240/300s 的退避根本不会执行。⑤ 不调任何参数，端到端复现了 PR 的动机场景。
- ⑪ 量化了 PR 已列为范围外的缺口。未设置 `maxRetries` 时，OpenAI SDK（`DEFAULT_MAX_RETRIES = 3`）会自行遵守小于 60s 的 `Retry-After`，休眠时不发通知。在默认 180s 窗口下，这段静默时间最多为 3 × <60s。所以只有 `stallMs` 很小，或 provider 连续用接近 60s 的 `Retry-After` 回 429 时才会受影响。
- PR 可以干净地合入当前 `main`（`09411aa`）。唯一共同改动的文件是 `llm-chat.ts`，`main` 在 `sendMessageStream` 开头加了一个无关的检查。

### 单元测试与变异测试
- **PR head 上 6 个改动的测试文件 1101/1101 通过**（38s）。更广的相关套件（`src/agents/runtime`、`baseLlmClient`、`turn`、`tools/workflow`、`utils/retry*`、`llm-chat*`）：2414 通过、0 失败、7 跳过。
- **负对照：** 把 7 个行为文件回退到 base，保留 `retry-wait.ts`、新事件类型和 PR 的测试。恰好 42 个测试失败，全部是新增测试；其余 1059 个保持通过。
- **变异测试：** 36 个定向单行变异，29 个被杀死。其中"去掉 `setTimeout` 分段"是让 `workflow-stall.test.ts` 陷入 100% CPU 死循环而不是失败。7 个存活：
  - 5 个在所有实际可能出现的事件顺序下等价，或纯属防御性代码：
    - 在 `arm()` 中删除过期等待；
    - 把过期等待采纳为时间基准；
    - 重复 `start` 被重新发布；
    - deadline 计时器的提前唤醒复查；
    - deadline 计时器里的父级 abort 检查。

    过期之后可能触发的每一次 `arm()`，要么标记活动，要么加入一个过期更晚的等待。`beginRetryWait` 生成的 id 唯一，watchdog 还会再去重一次 start。deadline 最多 100 分钟，计时器不会分段。父级 abort 让等待结束后，本轮会立即关闭并清除计时器。
  - 去掉本轮 observer 中的 `closed` 检查：测试只覆盖了迟到的 *end*，没有覆盖迟到的 *start*。这是防御性代码，我没有找到会产生迟到 start 的路径。
  - **等待期间的 deadline 从本轮开始而不是 agent 开始计时**：这是唯一值得补测的缺口。`measures the limit from the original start and shares it across waits` 只跑一轮，而该轮的 scope 恰好在 `startTime` 创建，因此测试区分不出两者。在该变异下，多轮 agent 的超时可以超出时限将近一整个时限。我写了一个两轮探针：第 1 轮耗时 50s 后调用工具，第 2 轮进入 2h 退避，时限 1 分钟。**PR 上在 60.0s 结束，变异下要到 110s**。

### 建议（非阻塞）
1. 补上述两轮时限测试，可直接粘贴的代码见素材目录 `harness/suggested-test-time-limit-across-rounds.ts.txt`。
2. 在 `splits an over-long wait instead of overflowing setTimeout` 中断言传给 `setTimeout` 的延迟，或限制 fake timer 的推进量。按现在的写法，该处一旦回归，单测任务会卡住而不是失败。

triage 提到的几处小问题确实存在但无害，我没有补充：catch-all 映射为 TIMEOUT、deadline 计时器未 `unref()`、可复用 `getRemainingTimeMs`。

### 未验证
- **macOS / Windows。** 改动都是与平台无关的计时器与 AsyncLocalStorage 逻辑，CI 在 Linux 上跑过。
- **Node 24。** 本环境是 Node 22，与 CI 相同；作者跑的是 Node 24。因此 AsyncLocalStorage 传播进惰性迭代流的行为，现在两个版本上都已确认可用。
- **真实 provider 流量。**

证据：图片、逐次运行的原始数据（`data/scenario-runs.jsonl`、`data/mutants.json`、`data/unit-tests.json`）以及完整 harness 见本目录。
