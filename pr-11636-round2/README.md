## Maintainer verification, round 2 — the `1978710438` fix on a real stack (macOS)

[My earlier report](https://github.com/QwenLM/qwen-code/pull/11636#issuecomment-5648574734) verified `d8a1413e20` on Linux against a real `qwen serve` daemon and the real Web Shell. The PR has since gained the fix commit `1978710438` (R1-4 / R2-1 / R2-2) and merged `main` into the current head `515ce9c`. This round covers **that delta only**: does the new fix do what it claims on a real stack, and did the fix — or the merge — break anything that was already working?

**Verdict: the fix is sound, and I still recommend merge.**

- **R1-4 is a real defect with a real fix.** On the pre-fix tree a Live orchestrator parked in `wait_threads` never wakes when the thread it is waiting on processes a background result while idle — it sits until its timeout, 120 s by default. On head it returns the instant the automatic continuation ends. Reproduced 2/2 per arm on a real daemon.
- **R2-1 and R2-2 are one-line hardenings.** Their new regressions have real discriminating power — they fail on the pre-fix tree — but I could not reach either state through any flow I can drive end to end. §3 says exactly what I tried.
- **No regression.** Every behaviour my first report established on `d8a1413e20` reproduces on `515ce9c`, now on macOS.

### Arms and environment

| | |
| --- | --- |
| **head** | `515ce9c`, `npm ci` + `npm run build` + `npm run bundle` |
| **pre-fix** | the same worktree, APFS-cloned, with **only** the three production hunks of `1978710438` reverted (+12 / −9 lines; the commit's new tests left in place) — `revert-fix.patch` in the evidence dir |
| host | macOS 15.6 (Darwin 25.6), Node 22.23.2, Chromium 1228 / Playwright 1.61.1 |
| per arm | its own `HOME`, workspace, `QWEN_RUNTIME_DIR`, daemon port and provider |
| provider | an OpenAI-compatible mock that routes on conversation state, never on a request counter; a background agent "runs" for exactly as long as the mock holds its subagent request |
| oracles | `GET /session/:id/status` and `GET /workspaces/:ws/sessions/live-state` at 200 ms, the SSE stream, the provider request bodies, the Web Shell DOM, and the return value of the daemon's own `wait_threads` |

The PR's own evidence is macOS plus a mock daemon; my first report was Linux plus a real daemon. This one is **macOS plus a real daemon**, so between the two rounds the real transport is now covered on both platforms.

### 1. R1-4 — `wait_threads` across a background automatic continuation

![R1-4 A/B](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11636-round2/fig1-r14.png)

Same scenario on both arms: a background agent returns 6 s after the parent turn ended, the daemon starts an automatic continuation (6 s model answer), and a Live orchestrator calls `wait_threads(targets=[this thread], timeoutMs = 25 000)` while that continuation is the session's active execution. `waitThreads` returns `inactiveStatus` immediately when the thread has no active prompt, so the probe arms the wait only once `/status` reports `hasActivePrompt: true` with a `backgroundTurn` — exactly the state the fix is about.

| | pre-fix | head |
| --- | --- | --- |
| `timedOut` | **true**, both runs | false |
| `wake` | `null` | `{reason: "turnCompleted", threadId, hostId: "local"}` |
| waited | 25.01 s — the cap | 5.93 s / 6.04 s, i.e. it returns as the continuation ends |
| control: ordinary user turn in the same session | wakes at 8.07 s / 8.10 s | wakes at 8.07 s / 8.12 s |

The control is what makes this specific: the pre-fix waiter is not broken in general, only for a terminal that carries `backgroundTurn`. With the default `timeoutMs` of 120 s the pre-fix behaviour is a two-minute hang on every thread that handles a background result while idle.

And the part a unit test can only assume: **at the moment the background terminal reaches the waiter, the daemon's own session summary already reads `hasActivePrompt: false`**, so the new guard falls through and wakes. Had the summary still read `true` at that instant the fix would not fire at all; on the real daemon it does not.

<details>
<summary>How the probe reaches <code>wait_threads</code></summary>

The Live task tools are registered only for a Live Voice session, and `POST /session` refuses to create one (`reserved_session_source`), so the caller has to be the Live Voice host. Rather than stand that up, the probe calls the daemon's **own** `LiveTaskService` instance — the same object the host reaches over the ACP control channel — through a Node loader that injects exactly two lines into the daemon's compiled `live-task-service.js`: one captures the instance the daemon constructs, one skips `assertLiveCaller`, the authorization gate a probe cannot satisfy without a host.

`eventWakeReason` and the `waitForTarget` guard — the code under test — are untouched, and the bridge, the ACP child, the background agent, the event stream and the session summary are all the real daemon's. For this probe only, the daemon runs from the unbundled compiled entry (`packages/cli/dist/index.js`) so the module can be instrumented; every other scenario in this report runs the bundled `dist/cli.js`.

</details>

### 2. Regression re-check on `515ce9c` — real daemon, real Web Shell, macOS

![Web Shell on head](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11636-round2/fig2-webshell.png)

![Sidebar](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11636-round2/fig3-sidebar.png)

Each of these reproduced what my first report recorded for the PR arm, 2/2:

| scenario | what the real stack does on head |
| --- | --- |
| idle parent receives a result (REST) | `/status` and live-state go `false` → `true` with `backgroundTurn: …########notification…`; `hasRunningBackgroundTasks: true` while the agent runs and the parent is idle; terminal is `turn_complete{promptId = bg turnId}` plus `background_notification_turn_complete` |
| result during a silent tool call (REST) | the provider request after the 6 s `sleep` carries `[tool, user(<task-notification>)]` in the **same** prompt; one `turn_complete`; `hasActivePrompt` never drops |
| two results, Web Shell | one marker each in return order, one user round, the final main-agent answer retained when folded; **View details** opens the originating task with the subagent's own transcript; **Source** expands the launching tool; no page errors |
| sidebar | amber leading dot while the parent is idle and agents run; the spinner takes priority once the parent model executes |
| steering during the continuation | the page sends `POST /mid-turn-message → 200 {"accepted":true}`; the continuation completes (`turn_complete{backgroundTurn, end_turn}`), `mid_turn_message_injected` follows, and the model answers both the result and the message inside that execution |
| reload during the continuation | the daemon still reports `hasActivePrompt: true` with `backgroundTurn`; the page restores `Processing Alpha probe results` and exactly one marker — replay does not duplicate it — and settles when the turn ends |
| Stop keeps queued results | Esc in the composer sends `POST /cancel → 204`; Beta does not auto-start; it reaches the model as an automatic continuation right after the next user prompt |

Unit suites on macOS, only the test files this PR touches — **6 480 cases, 0 failures**:

| package | cases |
| --- | --- |
| `acp-bridge` (bridge, bridgeClient, transcript-replay) | 1 161 |
| `cli` (Session, acpAgent, active-work-reporter, create-sub-session, live-task-service, multi-workspace-sessions) | 1 953 |
| `core` (background-tasks, chatRecordingService, monitorRegistry, transcript-records) | 380 |
| `sdk-typescript` (DaemonSessionClient, daemon-public-surface, daemonUi) | 493 |
| `channels/base` (AcpBridge, DaemonChannelBridge) | 171 |
| `qwen-live` (acp-adaptor, qwen-code-adaptor) | 78 |
| `web-shell` (15 files) | 2 244 |
| **total** | **6 480** |

### 3. R2-1 and R2-2 — what I could and could not reach

**Mutation A/B.** Running the three touched test files on both arms isolates exactly the five new regressions, and nothing else in those files moves — so the patch is as narrow as it claims:

| test file | pre-fix | head |
| --- | --- | --- |
| `cli/src/serve/live/live-task-service.test.ts` | 1 failed, 29 passed | 30 passed |
| `web-shell/client/components/MessageList.test.ts` | 2 failed: *reconciles a consumed agent / shell completion from the transcript producer without a task record* | all passed |
| `web-shell/client/daemon/session/actions.test.ts` | 2 failed: *ignores an older active=true / active=false response after SSE starts B in a standalone session* | all passed |
| both web-shell files combined | 4 failed, 390 passed | 394 passed |

The two *mismatched owner* cases in `actions.test.ts` pass on both arms — they are the controls, not the defect.

**R2-1 in the real stack — not reached.** The marker's descriptor is `{...backgroundTurn, backgroundTask: tasksByExecution.get(turnId)}`, and `tasksByExecution` is filled from the `background_task_completed` / `background_notification` block for the same task earlier in the same block list (`transcriptToMessages.ts`). The fix only matters when that block is absent. I drove four flows on both arms; the block was present every time, and the two arms produced the same rendering and the same DOM facts (timestamps and workspace name normalised):

| flow | pre-fix vs head |
| --- | --- |
| live stream, both results consumed with the tab open | identical |
| `location.reload()` after both results | identical |
| daemon stopped and restarted, then the session opened fresh | identical |
| bounded first history page — the client's `historyPageSize` rewritten to 3 on the wire, so the daemon returns a short first page | identical |

So this hunk reads as hardening against a state I could not produce from the shipped flows rather than a fix for something users hit in them. That is not a claim it is unreachable — only that four plausible routes to it all still carried the record.

**R2-2 in the real stack — not staged.** The guard only differs when a pane's connection is standalone (`connection.workspaceCwd === undefined`) while its activity bridge publishes an owner that *has* a `workspaceCwd` — reachable through `ChatPane`'s `workspaceCwd` prop, which `SplitView` fills from `paneWorkspaceCwd` — and it needs a live-state response that started before the background turn and lands after it. I did not build that combination end to end this round; it rests on the regression above.

### Still not covered

- Lost end-notification recovery through the heartbeat, cross-client stale-terminal ordering, and the worktree-reset barrier: exercised by the suites, not by a driven E2E. Unchanged from round 1.
- Live-provider variability, Windows, and the interactive TUI path.
- The three non-blocking observations in my first report stand as the author recorded them; this round found nothing to add to them.

Harness, raw run JSON, screenshots and the exact A/B patch: <https://github.com/wenshao/qwen-code/tree/asserts/pr-11636-round2>

<details>
<summary>中文说明</summary>

## 维护者验证 · 第二轮 —— 在真实环境上验证 `1978710438` 这次修复（macOS）

[上一份报告](https://github.com/QwenLM/qwen-code/pull/11636#issuecomment-5648574734)在 Linux 上用真实 `qwen serve` daemon 和真实 Web Shell 验证了 `d8a1413e20`。此后 PR 增加了修复提交 `1978710438`（R1-4 / R2-1 / R2-2），并合入 main 得到当前 head `515ce9c`。本轮**只覆盖这部分增量**：新修复在真实环境里是否确实做到了它声称的事，以及这次修复或这次合并有没有破坏原本已经正常的行为。

**结论：修复成立，仍然建议合并。**

- **R1-4 是真实缺陷，修复也是真实有效的。** 在未修复的树上，Live 编排方停在 `wait_threads` 里，当它等待的 thread 在空闲状态下处理后台结果时，它永远不会被唤醒，只能等到超时（默认 120 s）。在 head 上，自动续跑一结束它就立即返回。两臂各 2/2 复现，跑在真实 daemon 上。
- **R2-1 和 R2-2 是一行级别的加固。** 新增回归确实有辨别力（在未修复的树上会失败），但我没能通过任何可以端到端驱动的流程复现出这两种状态。第 3 节列出我尝试过的路径。
- **没有回归。** 第一轮在 `d8a1413e20` 上确认的每一条行为，在 `515ce9c` 上都复现了，这次是在 macOS 上。

### 对照与环境

| | |
| --- | --- |
| **head** | `515ce9c`，`npm ci` + `npm run build` + `npm run bundle` |
| **pre-fix** | 同一个 worktree 的 APFS 克隆，**只**回退 `1978710438` 的三处生产代码 hunk（+12 / −9 行，该提交新增的测试保留）—— 证据目录里的 `revert-fix.patch` |
| 宿主 | macOS 15.6（Darwin 25.6）、Node 22.23.2、Chromium 1228 / Playwright 1.61.1 |
| 每臂 | 独立的 `HOME`、工作区、`QWEN_RUNTIME_DIR`、daemon 端口和模型服务 |
| 模型 | OpenAI 兼容 mock，按对话状态路由而非请求计数；后台 agent 的"运行时长"就是 mock 挂住那次 subagent 请求的时长 |
| 观测点 | `GET /session/:id/status` 与 `GET /workspaces/:ws/sessions/live-state`（200 ms 轮询）、SSE 流、provider 请求体、Web Shell DOM，以及 daemon 自己 `wait_threads` 的返回值 |

PR 自带证据是 macOS + mock daemon；我第一轮是 Linux + 真实 daemon；这一轮是 **macOS + 真实 daemon**。两轮合起来，真实链路在两个平台上都覆盖到了。

### 1. R1-4 —— 自动续跑期间的 `wait_threads`

两臂使用完全相同的场景：后台 agent 在父 turn 结束后 6 s 返回，daemon 启动自动续跑（模型回复 6 s），Live 编排方在这次续跑正是 session 活跃执行时调用 `wait_threads(targets=[该 thread], timeoutMs = 25 000)`。`waitThreads` 在 thread 没有活跃 prompt 时会立刻返回 `inactiveStatus`，所以探针只在 `/status` 报出 `hasActivePrompt: true` 且带 `backgroundTurn` 之后才发起等待——这正是本次修复针对的状态。

| | pre-fix | head |
| --- | --- | --- |
| `timedOut` | **true**，两次运行都是 | false |
| `wake` | `null` | `{reason: "turnCompleted", threadId, hostId: "local"}` |
| 等待时长 | 25.01 s，即超时上限 | 5.93 s / 6.04 s，即续跑结束的瞬间返回 |
| 对照：同一 session 的普通用户轮次 | 8.07 s / 8.10 s 唤醒 | 8.07 s / 8.12 s 唤醒 |

对照组说明了问题的特异性：未修复臂的等待方并不是整体失效，只对带 `backgroundTurn` 的终态失效。按默认 120 s 超时计算，未修复的行为就是：只要某个 thread 在空闲时处理了一次后台结果，等待方就会白等两分钟。

还有一点是单测只能假设、而真实环境才能确认的：**后台终态送到等待方的那一刻，daemon 自己的 session summary 已经是 `hasActivePrompt: false`**，所以新的判断会落到唤醒分支。如果那一刻 summary 仍然是 `true`，这个修复就完全不会生效；在真实 daemon 上它不是。

探针如何触达 `wait_threads`：Live 任务工具只对 Live Voice session 注册，而 `POST /session` 会拒绝创建这类 session（`reserved_session_source`），调用方本应是 Live Voice 宿主。我没有去搭那套宿主，而是让探针直接调用 daemon **自己**构造的 `LiveTaskService` 实例——也就是宿主通过 ACP 控制通道触达的同一个对象——方式是用一个 Node loader 往 daemon 编译产物 `live-task-service.js` 里注入恰好两行：一行捕获 daemon 构造出的实例，一行跳过 `assertLiveCaller`（探针在没有宿主时无法满足的鉴权门）。被验证的代码本身（`eventWakeReason` 与 `waitForTarget` 里的守卫）没有改动，bridge、ACP 子进程、后台 agent、事件流和 session summary 全部是真实 daemon 的。仅这一个探针从未打包的编译入口（`packages/cli/dist/index.js`）启动 daemon 以便注入；本报告其它场景都跑打包后的 `dist/cli.js`。

### 2. `515ce9c` 上的回归复查 —— 真实 daemon、真实 Web Shell、macOS

以下每条都复现了第一轮记录的 PR 臂行为，各 2/2：

| 场景 | head 上真实链路的表现 |
| --- | --- |
| 空闲主智能体收到结果（REST） | `/status` 与 live-state 从 `false` 变回 `true` 并带 `backgroundTurn: …########notification…`；主智能体空闲、agent 运行期间 `hasRunningBackgroundTasks: true`；终态是 `turn_complete{promptId = 后台 turnId}` 加 `background_notification_turn_complete` |
| 静默工具调用期间返回的结果（REST） | 6 s `sleep` 之后那次 provider 请求是**同一个 prompt** 内的 `[tool, user(<task-notification>)]`；只有一次 `turn_complete`；`hasActivePrompt` 全程不掉 |
| Web Shell 两条结果 | 每条结果一个标记、按返回顺序排列，仍是一个用户轮次，折叠后保留最终主回复；**View details** 打开对应任务并显示 subagent 自己的 transcript；**Source** 展开原始工具调用；无页面报错 |
| 侧栏 | 主智能体空闲、agent 运行时显示前置琥珀色圆点；主模型执行时改为 spinner 优先 |
| 续跑期间插入消息 | 页面发出 `POST /mid-turn-message → 200 {"accepted":true}`；续跑完整结束（`turn_complete{backgroundTurn, end_turn}`），随后 `mid_turn_message_injected`；模型在这一次执行内同时回应了结果和用户消息 |
| 续跑期间刷新页面 | daemon 仍报 `hasActivePrompt: true` 并带 `backgroundTurn`；页面恢复出 `Processing Alpha probe results` 和恰好一个标记（回放没有造成重复），turn 结束后正确收尾 |
| Stop 保留排队结果 | composer 里按 Esc 发出 `POST /cancel → 204`；Beta 不会自动启动；在下一条用户 prompt 之后作为自动续跑到达模型 |

macOS 上的单测，只跑本 PR 改动到的测试文件 —— **6 480 项通过，0 失败**：

| 包 | 用例数 |
| --- | --- |
| `acp-bridge` | 1 161 |
| `cli` | 1 953 |
| `core` | 380 |
| `sdk-typescript` | 493 |
| `channels/base` | 171 |
| `qwen-live` | 78 |
| `web-shell`（15 个文件） | 2 244 |
| **合计** | **6 480** |

### 3. R2-1 与 R2-2 —— 触达到的与没触达到的

**变异 A/B。** 在两臂上跑这三个被改动的测试文件，恰好隔离出五项新增回归，文件里其它用例在两臂都不变，说明补丁范围确实很窄：

| 测试文件 | pre-fix | head |
| --- | --- | --- |
| `cli/src/serve/live/live-task-service.test.ts` | 1 失败 / 29 通过 | 30 通过 |
| `web-shell/client/components/MessageList.test.ts` | 2 失败：*reconciles a consumed agent / shell completion from the transcript producer without a task record* | 全部通过 |
| `web-shell/client/daemon/session/actions.test.ts` | 2 失败：*ignores an older active=true / active=false response after SSE starts B in a standalone session* | 全部通过 |
| 两个 web-shell 文件合计 | 4 失败 / 390 通过 | 394 通过 |

`actions.test.ts` 里两条 *mismatched owner* 用例在两臂都通过——它们是对照，不是缺陷本身。

**R2-1 在真实环境中未触达。** 标记的描述符是 `{...backgroundTurn, backgroundTask: tasksByExecution.get(turnId)}`，而 `tasksByExecution` 来自同一批 block 中更早出现的、同一 task 的 `background_task_completed` / `background_notification` block（`transcriptToMessages.ts`）。只有那条 block 缺失时这个修复才起作用。我在两臂上驱动了四种流程，每次那条 block 都在，两臂的渲染结果和 DOM 事实完全一致（时间戳与工作区名归一化后逐字相同）：

| 流程 | pre-fix 与 head 对比 |
| --- | --- |
| 保持标签页打开，实时流消费两条结果 | 一致 |
| 两条结果消费完后 `location.reload()` | 一致 |
| 停掉并重启 daemon，再重新打开该 session | 一致 |
| 限制首页历史 —— 在链路上把客户端 `historyPageSize` 改写为 3，让 daemon 返回很短的首页 | 一致 |

所以这一处更像是针对"我无法从已有流程造出来的状态"所做的加固，而不是在修一个用户当下会遇到的问题。这不等于说它不可达，只是四条合理路径都仍然带着那条记录。

**R2-2 在真实环境中未搭出来。** 这个守卫只在一种组合下才有差别：面板的连接是 standalone（`connection.workspaceCwd === undefined`），而它的活动桥发布的 owner **带**有 `workspaceCwd`——可以通过 `ChatPane` 的 `workspaceCwd` prop 触达，`SplitView` 会用 `paneWorkspaceCwd` 填它——并且还需要一次"请求早于后台 turn 开始、响应晚于它到达"的 live-state 响应。本轮我没有把这个组合端到端搭出来；它靠上面的回归用例支撑。

### 仍未覆盖

- 通过心跳恢复丢失的结束通知、跨客户端旧终态顺序、worktree 重置屏障：由测试套件覆盖，没有做驱动式 E2E。与第一轮相同。
- 真实模型输出差异、Windows、交互式 TUI 路径。
- 第一轮提出的三条非阻塞观察维持作者记录的处置；本轮没有新增内容。

Harness、原始运行 JSON、截图与精确的 A/B 补丁：<https://github.com/wenshao/qwen-code/tree/asserts/pr-11636-round2>

</details>
