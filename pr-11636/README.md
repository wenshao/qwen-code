## Maintainer verification — real daemon + real Web Shell, Linux

I built a local verification environment and drove this PR end to end on **Linux**, with a **real `qwen serve` daemon**, its **real ACP child** (the CLI `Session`), **real background agents**, and the daemon's **own Web Shell bundle in Chromium**. The PR's own evidence is macOS plus a mock daemon and deterministic `Session` probes; this report covers the real-transport and Linux gap.

**Verdict: recommend merge.** Every Before/After row I could reach reproduces on the real transport, in the direction the PR claims. I found no regression. Three non-blocking observations are listed at the end.

- Arms: **base** = merge base `e432e40580`, **PR** = head `d8a1413e20`. Each arm is its own worktree with its own `npm ci` and its own daemon, `HOME` and workspace. Both arms use the same scripted model.
- Model: an OpenAI-compatible mock that routes on conversation state, never on a request counter. A background agent "runs" for exactly as long as the mock holds its subagent request.
- Oracles:
  - `GET /session/:id/status` and `GET /workspaces/:ws/sessions/live-state`, polled every 200 ms
  - the SSE stream `GET /session/:id/events`
  - **the provider request bodies**, i.e. what the model actually received
  - Web Shell DOM facts and screenshots

![wire-level A/B](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11636/fig0-wire.png)

### 1. Idle parent: the automatic continuation is now a real execution

A background agent returns 6 s after the parent turn ended. The mock answers the notification over 6 s.

| | base | PR |
| --- | --- | --- |
| `/status` and live-state during the 6 s reply | `hasActivePrompt:false` for the whole reply | `hasActivePrompt:true`, `backgroundTurn:{turnId:"…########notification…"}` |
| `hasRunningBackgroundTasks` while the agent runs and the parent is idle | absent | `true`, then `false` once the task finishes |
| terminal event | `background_notification_turn_complete`, no `promptId` | `turn_complete{promptId:<bg turnId>, stopReason:"end_turn"}` + `background_notification_turn_complete` |
| runs | 2 | 2 |

### 2. A result that returns during a silent tool call is consumed in the same prompt

The parent launches an agent (1.5 s) and then runs a 6 s `sleep` tool call.

| | base | PR |
| --- | --- | --- |
| provider request after the `sleep` result | `[tool]` only; the result waits | `[tool, user(<task-notification>)]`, in the **same** prompt |
| extra automatic turn | yes, after `turn_complete`, while the daemon reports `hasActivePrompt:false` | none; a single `turn_complete` |
| identity on the result's display chunk | the `promptId` of the prompt that was **just ending** | the consuming prompt |

The default-cap overflow runs show the same effect: PR consumed 11 + 9 results at two boundaries inside the user prompt, and only the last straggler used an automatic turn.

### 3. Typing into the Web Shell during an automatic continuation

![steer A/B](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11636/fig1-steer.png)

| | base | PR |
| --- | --- | --- |
| request the page sends | `POST /session/:id/prompt → 202` | `POST /session/:id/mid-turn-message → 200 {"accepted":true}` |
| the 12 s continuation | **cut off mid-reply** (3.4 s in on run 1); `background_notification_turn_complete{reason:"cancelled"}`; the provider stream is closed by the client | completes; then `mid_turn_message_injected` carrying the background `turnId` |
| the user's message | runs as a separate prompt, and the answer about the result is lost | consumed at the continuation's boundary; the model sees the result **and** the message in one execution |
| runs | 2/2 | 2/2 |

### 4. Reloading the page during the continuation

![reload A/B](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11636/fig2-reload.png)

- **PR:** after reload the daemon still reports `hasActivePrompt:true` with `backgroundTurn`. The page restores `Processing Alpha probe results`, the sidebar spinner and exactly one marker (not duplicated by replay), then settles when the turn ends.
- **base:** the daemon reports idle. While the model is still answering, the page shows *"The previous request was interrupted before the response completed."* with a **Continue execution** button.
- Runs: 2/2 per arm.

### 5. Stop keeps queued results

Alpha's continuation is running and Beta's result is already queued. I stop from the composer with Esc, wait, then send a new prompt.

![stop A/B](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11636/fig3-stop.png)

| | base | PR |
| --- | --- | --- |
| Esc in the composer | sends no cancel request (the client does not own that execution), so I cancelled through `POST /cancel` | `POST /session/:id/cancel → 204`; `turn_complete{promptId:<bg turnId>, stopReason:"cancelled"}` |
| Beta auto-starts after stop | no | no (paused, as designed) |
| Beta reaches the model | **never**, including after the new prompt | yes, as an automatic continuation right after the new prompt |
| cancelled Alpha result still in model history | yes | yes |
| runs | 2 (REST + UI) | 2 (REST + UI) |

### 6. Queue overflow at one boundary

With the default cap of 10 concurrent background agents, results arrive in waves, and the launching tool call only returns after the 21st agent starts. So 21 same-turn results never met at one boundary: 21/21 were delivered with no drop in both overflow runs.

With `QWEN_CODE_MAX_BACKGROUND_AGENTS=30`, all 21 finish during one silent tool call:

| | base | PR |
| --- | --- | --- |
| provider requests carrying results | 20 automatic turns, one result each; the first also carries the drop summary | **one** request: user parts = `[drop summary, 20 results]`, summary first |
| extra automatic turn | — | none; a single `turn_complete` |
| daemon `hasActivePrompt` meanwhile | `false` throughout | `true` (same user prompt) |

### 7. Web Shell presentation

![two results](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11636/fig4-two-results.png)

![sidebar](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11636/fig5-sidebar.png)

Two agents return after the parent went idle (PR).

- **Markers:** one marker per result, in return order. There is still a single user row, and the collapsed view keeps the final main-agent answer; the intermediate answer is folded.
- **View details** opens the right panel on the right task, showing the subagent's own transcript (`SUBRESULT-alpha`). **Source** expands the originating tool.
- **Sidebar:** with the parent idle and agents running, the row shows the amber dot. While the parent model executes, the spinner takes over. Base shows the generic spinner for background-only activity.
- **Console:** no page errors in either arm.

### Tests on Linux

| suite (only the test files this PR touches) | result |
| --- | --- |
| `acp-bridge` (bridge, bridgeClient, transcript-replay) | 1161 passed |
| `cli` (Session, acpAgent, active-work-reporter, create-sub-session, live-task-service, multi-workspace-sessions) | 1919 passed |
| `core` (background-tasks, chatRecordingService, monitorRegistry, transcript-records) | 380 passed |
| `sdk-typescript` (DaemonSessionClient, daemon-public-surface, daemonUi) | 493 passed |
| `channels/base` (AcpBridge, DaemonChannelBridge) | 171 passed |
| `qwen-live` (acp-adaptor, qwen-code-adaptor) | 78 passed |
| `web-shell` (15 files) | 2236 passed |
| **total** | **6438 passed, 0 failed** |

The PR's Playwright spec `web-shell.background-turn.spec.ts` passes 2/2 on head. Run against base, it fails 2/2: `Processing Rendering investigation results` and `[data-web-shell-session-background-running]` do not exist there, so the spec is not vacuous. All CI checks on `d8a1413e20` are green.

### Observations (non-blocking)

1. **A retained result is invisible after Stop.** After Esc the default view shows *"You cancelled this request"* under Alpha. Nothing on screen says that Beta's result is waiting, and it only runs once the user sends something. This is the documented behaviour; a visible `Awaiting processing` hint (the `background.pending` string already exists) might be worth a follow-up.
2. **The user's own answer can be folded behind a retained result.** When Beta is processed right after the user's new prompt, the fold keeps the automatic reply (`HANDLED[Beta probe]`) as that turn's final answer. The direct answer to the user's new question (`AFTER-DONE…`) is collapsed under *Processed 4s* (right panel of fig 3). This matches the design's "last complete main-agent reply, including automatic execution" rule; I'm raising it only in case that isn't the intended UX for this specific case.
3. **The raw ACP stream carries the completion text twice.** Each completed task emits two discrete `agent_message_chunk`s with the same text: `background_task_completed` at enqueue and `background_notification` at consumption.
   - Web Shell de-duplicates them.
   - `AcpBridge` / `DaemonChannelBridge` only forward `background_notification_response`.
   - The `create_sub_session` first-turn collector and qwen-live now exclude all three sources.

   So only a third-party ACP host that renders every discrete text chunk would show the text twice. This is the triage bot's open question (1), now with wire evidence.

### Not covered here

- Lost end-notification recovery through the heartbeat, cross-client stale-terminal ordering (R1-7 / R1-8) and the worktree-reset barrier are exercised by the suites above, not by a driven E2E.
- Live-provider variability, macOS / Windows, and the interactive TUI path (unchanged by design).

<details>
<summary>Environment / how to reproduce</summary>

- Linux 6.12, Node 22, Chromium 1228 (Playwright). Each worktree: `git worktree add --detach … && npm ci` (this builds `dist/cli.js` and `dist/web-shell`).
- Daemon: `node dist/cli.js serve --port <p> --token <t> --workspace <ws>`, with `OPENAI_BASE_URL` pointing at the mock and `tools.approvalMode: "yolo"`. Sessions are created with `POST /session {cwd, sessionScope:"thread", approvalMode:"yolo"}`.
- Harness, raw figures and this report: `https://github.com/wenshao/qwen-code/tree/asserts/pr-11636`.
  - `mock-llm.mjs`: scenario scripts
  - `run.mjs`: REST scenarios `idle|same|stop|overflow|overflowb`
  - `ui-steer.mjs`, `ui-reload.mjs`, `ui-stop.mjs`, `ui-two.mjs`: Web Shell scenarios
  - `show.mjs`: merged wire timeline
- The shell tool blocks a bare `sleep N`; the mock appends `# intentional-sleep: …`. Tool-call ids must be unique per session, or the CLI ignores the duplicate call.

</details>

<details>
<summary>中文说明</summary>

## 维护者验证 — 真实 daemon + 真实 Web Shell，Linux

我在本地搭建了验证环境，在 **Linux** 上端到端驱动本 PR。环境里是**真实的 `qwen serve` daemon**、它**真实的 ACP 子进程**（CLI `Session`）、**真实的后台 agent**，以及 daemon 自带的 **Web Shell 页面（Chromium）**。PR 自带的证据是 macOS + mock daemon + 确定性 `Session` 探针，本报告补的是真实传输链路和 Linux 这块空白。

**结论：建议合并。** PR 的 Before/After 表格中，我能触达的每一行都在真实链路上复现，方向与 PR 声称的一致；未发现回归。文末列出三条非阻塞观察。

- 对照：**base** = merge base `e432e40580`，**PR** = head `d8a1413e20`。两臂各自独立的 worktree、`npm ci`、daemon、`HOME` 和工作区，共用同一个脚本化模型。
- 模型：OpenAI 兼容 mock，按对话状态路由，而不是按请求计数；后台 agent 的"运行时长"就是 mock 挂住它那次 subagent 请求的时长。
- 观测点：
  - `GET /session/:id/status` 与 `GET /workspaces/:ws/sessions/live-state`，每 200 ms 轮询一次
  - SSE `GET /session/:id/events`
  - **provider 请求体**（即模型实际收到了什么）
  - Web Shell DOM 与截图

### 1. 主智能体空闲：自动续跑成为真正的执行

后台 agent 在父 turn 结束 6 s 后返回，mock 用 6 s 回复这条通知。

- **base**：回复期间 `/status` 与 live-state 始终是 `hasActivePrompt:false`；终态事件只有 `background_notification_turn_complete`，不带 `promptId`。
- **PR**：全程 `hasActivePrompt:true`，并带 `backgroundTurn`；父智能体空闲、agent 运行时 `hasRunningBackgroundTasks:true`；终态为带后台 turnId 的 `turn_complete`。
- 两臂各 2 次运行。

### 2. 静默工具调用期间返回的结果，在同一个 prompt 内被消费

- **PR**：`sleep` 工具结果之后的那次 provider 请求是 `[tool, user(<task-notification>)]`，属于同一个 prompt；只有一次 `turn_complete`，没有额外的自动 turn。
- **base**：父 turn 先结束，再另起一个自动 turn 处理结果，期间 daemon 报 `hasActivePrompt:false`；结果展示 chunk 上带的是**刚结束的** prompt 的 `promptId`。
- 默认并发上限下的溢出运行里，PR 在用户 prompt 内部的两个边界上分别消费了 11 条和 9 条结果，只有最后一条走了自动 turn。

### 3. 自动续跑期间在 Web Shell 中输入消息（图 1）

- **PR**：页面发出 `POST /mid-turn-message → 200 {"accepted":true}`；12 s 的续跑完整结束，随后发出带后台 turnId 的 `mid_turn_message_injected`；模型在同一次执行中既看到结果也看到用户消息。2/2 次。
- **base**：页面发出 `POST /prompt → 202`；续跑在回复中途被**切断**（第 1 次运行在 3.4 s 处），`background_notification_turn_complete{reason:"cancelled"}`；用户消息作为独立 prompt 执行，针对结果的那段回复丢失。2/2 次。

### 4. 续跑期间刷新页面（图 2）

- **PR**：刷新后 daemon 仍报 `hasActivePrompt:true` 并带 `backgroundTurn`；页面恢复出 `Processing Alpha probe results`、侧栏 spinner 和恰好一个标记（回放没有造成重复），turn 结束后正确收尾。
- **base**：daemon 报空闲；模型仍在回复时，页面显示"The previous request was interrupted before the response completed."，并提供 **Continue execution** 按钮。
- 两臂各 2/2 次。

### 5. Stop 保留排队结果（图 3）

Alpha 的续跑在进行、Beta 的结果已在排队时，在 composer 中按 Esc 停止，等待片刻后再发一条新 prompt。

- **PR**：发出 `POST /cancel → 204`，并有带后台 turnId 的 `cancelled` 终态；Beta 不会在停止后自动启动（按设计暂停）；新 prompt 之后 Beta 作为自动续跑被处理，模型收到了它。
- **base**：按 Esc 不发出任何取消请求（客户端并不掌握这次执行），我改用 REST 取消；Beta **始终没有**到达模型，发新 prompt 后也没有。
- 两臂被取消的 Alpha 结果都保留在模型历史中。两臂各 2 次（REST + UI）。

### 6. 单个边界上的队列溢出

默认并发上限是 10 个后台 agent，结果会分批返回，而且启动 agent 的那次工具调用要等第 21 个 agent 启动后才返回，所以 21 条同 turn 结果不会汇聚到同一个边界上。两次溢出运行里 21/21 全部送达，没有丢弃。

设置 `QWEN_CODE_MAX_BACKGROUND_AGENTS=30` 后，21 条结果都在一次静默工具调用期间完成：

- **PR**：只有**一次**请求，user parts = `[丢弃摘要, 20 条结果]`，摘要在前；只有一次 `turn_complete`，没有额外的自动 turn；期间 `hasActivePrompt:true`。
- **base**：拆成 20 个自动 turn，每个带一条结果，第一个另带丢弃摘要；期间 daemon 始终 `hasActivePrompt:false`。

### 7. Web Shell 展示（图 4、图 5）

以下为 PR 臂，两个 agent 在父智能体空闲后先后返回。

- **标记**：每个结果一个标记，按返回顺序排列；仍然只有一个用户行；折叠后保留最终主回复，中间回复被折叠。
- **View details / Source**：View details 在右侧面板打开对应任务，显示 subagent 自己的 transcript（`SUBRESULT-alpha`）；Source 展开原始工具调用。
- **侧栏**：父智能体空闲、agent 在运行时显示琥珀色圆点；父模型执行时改为 spinner。base 在仅有后台活动时显示普通 spinner。
- **控制台**：两臂均无页面报错。

### Linux 上的测试

仅运行本 PR 改动到的测试文件：

| 包 | 通过用例 |
| --- | --- |
| acp-bridge | 1161 |
| cli | 1919 |
| core | 380 |
| sdk-typescript | 493 |
| channels/base | 171 |
| qwen-live | 78 |
| web-shell | 2236 |
| **合计** | **6438 通过，0 失败** |

PR 自带的 Playwright 用例在 head 上 2/2 通过；放到 base 上跑 2/2 失败，说明用例不是空跑。`d8a1413e20` 上的 CI 全部为绿。

### 观察（非阻塞）

1. **Stop 后保留的结果在界面上不可见**：页面只显示"You cancelled this request"，看不出 Beta 结果在等待处理，要等用户下一次发消息才会执行。这符合设计，但可以考虑后续加一个 `Awaiting processing` 提示（`background.pending` 文案已存在）。
2. **用户自己问题的回答可能被折叠**：新 prompt 之后紧接着处理保留结果时，折叠规则把自动回复（`HANDLED[Beta probe]`）当作该轮的最终回答，用户新问题的直接回答（`AFTER-DONE…`）被折叠进 *Processed 4s*（图 3 右侧面板）。这与设计文档"保留最后一个完整主回复（含自动执行）"一致，仅提示此场景下是否符合预期 UX。
3. **原始 ACP 流上完成文本出现两次**：每个完成的任务会发两条文本相同的 `agent_message_chunk`：入队时的 `background_task_completed` 和消费时的 `background_notification`。
   - Web Shell 会去重。
   - `AcpBridge` / `DaemonChannelBridge` 只转发 `background_notification_response`。
   - `create_sub_session` 首轮收集器和 qwen-live 已排除这三种来源。

   因此只有逐条渲染离散文本 chunk 的第三方 ACP 宿主会显示两次。这就是 triage 机器人提出的问题 (1)，这里给出了线路层证据。

### 未覆盖

- 心跳恢复丢失的结束通知、跨客户端旧终态顺序（R1-7 / R1-8）、worktree 重置屏障：由上面的测试套件覆盖，未做驱动式 E2E。
- 真实模型输出差异、macOS / Windows、交互式 TUI 路径（按设计未改动）。

Harness、原始截图与本报告：`https://github.com/wenshao/qwen-code/tree/asserts/pr-11636`

</details>
