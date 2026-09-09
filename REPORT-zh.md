## 维护者本地验证 —— 真实环境，base 与 PR 对照

我在本地搭建了真实验证环境，用真实的 `CoreToolScheduler` / `Config` / 工具实例（不只是 PR
随附的单测）以及真实的 Qwen Code TUI 会话跑了这个改动。**修复是正确的、最小的、位置也放对了，
建议合并。** 有一处调用方的连带影响需要在合并前或合并同时定夺 —— 见发现 1。

### 环境

| | |
| --- | --- |
| base | `10895031e2`（`main` 与 PR head 的 merge-base），位于 `/root/git/base11483` |
| PR | `5ab8312f3f`，位于 `/root/git/pr11483` |
| 两个 arm | 各自独立 worktree，各自独立 `npm ci`（不共用 `node_modules`） |
| 运行时 | Node v22.22.2，npm 10.9.7，Linux 6.12.63 x86_64 |

---

### 1. 缺陷在单测之外同样可复现

独立 harness 直接 import 两个 arm **构建产物 `packages/core/dist`**，构造真实 `Config`，调用
`config.initialize()`（注册了 33 个真实工具），驱动真实 `CoreToolScheduler`。批次 A 用真实工具
把调度器占住；随后用一个在 `schedule()` **调用之前**就已 abort 的 `AbortController` 提交批次 B。

| 批次 A 的占用形态 | arm | 6 秒后批次 B | settle 耗时 | `requestQueue` |
| --- | --- | --- | --- | --- |
| `write_file` 停在 `awaiting_approval` | base | **pending** | — | **1** |
| `write_file` 停在 `awaiting_approval` | PR | rejected —— `Tool call cancelled while in queue.` | **≤ 1 ms** | 0 |
| `run_shell_command` 停在 `executing` | base | **pending** | — | **1** |
| `run_shell_command` 停在 `executing` | PR | rejected —— `Tool call cancelled while in queue.` | **≤ 1 ms** | 0 |

`awaiting_approval` 这一档就是 issue 描述的「无上界」场景：只有人回答审批提示才会释放。把提示挂起
20 秒再回答，base 上批次 B 在 **t+20010 ms** 才 settle —— 也就是无关批次被释放的那一刻，而不是
调用方取消的那一刻。

![R1](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11483/r1-core-ab.png)

**压力测试（真实工具执行期间连发 200 个预先 abort 的请求）：**

| | base | PR |
| --- | --- | --- |
| 立即 rejected | 0 / 200 | **200 / 200** |
| 延迟 resolved | **200 / 200** | 0 |
| `requestQueue` 峰值 | **200** | **0** |
| `onAllToolCallsComplete` 批次数 | **201**（其中 200 个是迟到的 `cancelled`） | 1（只有活动批次） |
| 活动批次结果 | `hold:success` | `hold:success` |
| unhandled rejection | 0 | 0 |

base 会在活动工具跑完之后，把 200 个陈旧的 `cancelled` 完成回调补放给调用方；PR 一个都不发，
并且活动调用仍然正常完成 —— 正是 PR 自己的验证计划要求的行为。

![R6](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11483/r6-soak-ab.png)

---

### 2. 新增回归测试非空转

把 PR 的测试文件原样放到 base 上运行：

```text
FAIL  src/core/coreToolScheduler.test.ts > CoreToolScheduler
      > rejects a pre-aborted queued request without waiting for the active batch
AssertionError: expected 'pending' to be 'rejected'
```

它在 base 上因为 bug 本身而失败，断言信息与 issue 的预测完全一致。

![non-vacuity](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11483/nonvacuity.png)

---

### 3. 回归面

| 套件 | 结果 |
| --- | --- |
| `packages/core` `coreToolScheduler.test.ts`（PR） | **407 / 407** |
| `packages/cli` `useReactToolScheduler.test.tsx` + `useToolScheduler.test.ts`（PR） | **33 / 33** |
| PR worktree 上完整 `npm run preflight` | **69,908 通过 / 12 失败 / 110 跳过 —— 12 个在 base 上同样失败** |

这 12 个 preflight 失败属于环境因素，不可归因于本 PR，我把每一个都在 base worktree 上重跑做了确认：
10 个是权限模拟测试（`... cannot be removed`、`unreadable owned lock`、`unlink silently fails`、
`glob fails`），在 `uid 0` 的沙箱里失效；另外 2 个是
`packages/qwen-live/src/manual/qodercli-acp.test.ts`，它驱动真实的外部 `qodercli --acp` 二进制
（两个 arm 上都报 `Invalid params: authId`）。它们都与调度器无关。

---

### 4. 变异矩阵

| 变异体 | core 调度器套件 | CLI 调度器套件 | 结论 |
| --- | --- | --- | --- |
| **M1** 删掉 guard（= base） | **407 中 1 失败**（406 通过） | — | 唯一失败的就是新测试，而且确实失败了 |
| **M2** 把 guard 提到 `if (this.isRunning() \|\| this.isScheduling)` 之上 | **407 中 3 失败** | — | 队列作用域确实被测试保护着 —— 见下 |
| **M3** 改掉 reject 的错误文案 | 407 / 407 | 33 / 33 | 文案没有任何测试固定 |

M2 是关键。#11146 提醒过：把检查移到 `schedule()` 顶部会改变空闲调度器的契约。这不是纸面担忧 ——
该变异体下有三条既有测试失败：

```text
× aborts immediately when the parent signal is already aborted before scheduling
× should cancel a tool call if the signal is aborted before confirmation
× pre-aborted signal: terminalizes before validation or execution
```

PR 把 guard 放在了唯一不会破坏它们的位置。

---

### 5. 调用方审计 —— 全部 `schedule()` 调用点

guard 只在调度器已经繁忙时才触发，而只有**共享**调度器才可能繁忙，所以我逐个核了全部 6 个生产调用点：

| 调用点 | 调度器生命周期 | 调用 `schedule()` 时可能繁忙吗？ | reject 的处理 |
| --- | --- | --- | --- |
| `agents/runtime/agent-core.ts:2263` | 每次 `processFunctionCalls()` 新建（`:1926` 构造，只调一次 `schedule()`，无循环） | 否 | `try/finally` 内 `await` |
| `core/nonInteractiveToolExecutor.ts:55` | 每次 `executeToolCall()` 新建 | 否 | `.catch(reject)` |
| `ui/opentui/client-tool-run.ts:108` | 每次命令执行新建（`:85`） | 否 | `void`，无 catch |
| `ui/opentui/live-session.ts:944` | 每个 live 轮次新建（`:867`） | 否 | `void`，无 catch |
| `ui/hooks/useReactToolScheduler.ts:229`（普通分支） | **共享，随 `useMemo` 存活** | **是** | `.catch` → `signal.aborted` 时丢弃 |
| `ui/hooks/useReactToolScheduler.ts:246`（full-turn 分支） | **共享** | **是** | `catch` → 合成 `UNHANDLED_EXCEPTION` |

因此两个 `void` 且无 catch 的 OpenTUI 调用点不会因这个 guard 产生 unhandled rejection，
`useReactToolScheduler` 就是全部影响半径。这与 issue 讨论串里的审计结论一致。

---

### 6. 经由真实 hook 的下游行为

我用**真实 `useReactToolScheduler`** 驱动**真实 `CoreToolScheduler`**，让一个真实调用把它占在
`executing`，然后分别走两条调用分支提交第二个请求：

| 分支 | abort 时机 | base | PR |
| --- | --- | --- | --- |
| 普通 | 预先 abort | 繁忙期间无卡片；释放后迟到的 `cancelled` 完成 | **直接丢弃**（无卡片、无完成回调 —— 调用方因 `signal.aborted` 吞掉） |
| full-turn | **预先 abort** | 繁忙期间无卡片；迟到的 **`cancelled`** 完成 | **`status: error`、`errorType: unhandled_exception`，卡片 "Full-turn tool scheduling failed. The tool was not executed."，并推进 `onComplete`** |
| full-turn | 入队后 abort | base 上**本来就是** `error` / `unhandled_exception` | 同样是 `error` / `unhandled_exception` |

![R4](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11483/r4-hook-ab.png)

---

### 7. 真实 TUI 会话，两个 arm

我还在两个 arm 上各跑了一次真实 `qwen` TUI，对接一个脚本化的 mock OpenAI 兼容服务，脚本完全一致：
`/approval-mode default` → 发一条提示 → 模型调用 `run_shell_command` → **调度器停在
`awaiting_approval`**，这正是本 guard 所限定的 `isRunning() === true` 前置条件 → `Esc` 拒绝 →
本轮干净结束，下一轮正常工作。

在工具调用这一段，两份 transcript 逐行一致；唯一差异是会话启动 banner 以及我在 PR arm 上多跑的一轮。
日常交互路径没有任何变化。

![TUI](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11483/tui-pr-approval.png)

---

### 发现

**发现 1 —— Important，需要定夺。full-turn 调用方会把新的 reject 变成合成的 `UNHANDLED_EXCEPTION`。**

`useReactToolScheduler.ts:246-282` 会捕获 full-turn `scheduler.schedule()` 的**任何** reject，
构造 `status: 'error'` / `ToolErrorType.UNHANDLED_EXCEPTION` 的调用，追加进 `toolCallsForDisplay`，
再交给 `allToolCallsCompleteHandler()` —— 后者会把该组提交进历史，并把这个错误当作工具结果发给模型。
这里没有普通分支 `:229` 那样的 `if (signal.aborted) return`。

这就是 #11148，而且在 base 上对于「入队后 abort」这一时序**已经是活的**（上表第三行，我在 base 上
复现过）。本 PR 改变的是「预先 abort」这一时序：base 上它得到的是干净但迟到的 `cancelled`，PR 上
变成了假错误。所以这是既有调用方缺陷的**扩面**，不是新的一类缺陷 —— 但就这一时序而言确实是严格回退：
用户取消被记录成调度失败并发给了模型。

可达性较窄：full-turn 分支是 agent-capable 视觉桥路径（`use-llm-stream.ts:1501/1527` 只有在
`getDefaultVisionBridgeModel()?.agentCapable` 时才设置 `\0` 结尾的 override），需要配置了
agent-capable 视觉模型、带图片的一轮、共享调度器正忙、并且在 `resolveForModel()` 期间 abort。
我**没能**在真实 TUI 会话里构造出这个精确竞态 —— 上面的证据来自真实 hook 驱动真实调度器。

按我的偏好排序的处理方式：
1. 先落 #11148 的调用方修复，或与本 PR 同批次落地，再合本 PR。
2. 或者接受：本 PR 消除的是无上界挂起，受影响路径是可选开启的，而且 #11148 已经在跟踪调用方。

无论哪种，这都是维护者的决定，不该塞进一个核心模块 PR —— AGENTS.md 要求这里保持紧凑 diff，本 PR 做到了。

**发现 2 —— Minor。被丢弃的请求不会走到完成回调，因此 `use-llm-stream.ts` 里按 callId 的簿记不会释放。**

`registerToolBatch()`（`:1074`）、`continuationOwnersByToolCallIdRef`（`:3192`）与
`interactionOwnersByToolCallIdRef`（`:3200`）都是在 `scheduleToolCalls()` **之前**写入的，
而只在完成路径上删除（`:1141`、`:4863-4864`、`:5015-5018`）。入队前就被 reject 的请求永远不会完成，
这三个条目会留到会话结束。压力测试显示量级有界且很小（每个被丢弃的调用一个 `Map` 条目），而且这是
**既有行为** —— 入队后 abort 的 reject 路径一直如此。建议记到 #11148，而不是在本 PR 里改。

还有一点值得明说，也正是这条只算 Minor 而不是 Important 的原因：base 上迟到的 `cancelled` 完成
同时也会为被丢弃的调用产生一个 `functionResponse`，而 PR 上没有任何东西会产生它。这不会留下线格式
非法的 transcript —— `repairOrphanedToolUseTurns`（`core/llm-chat.ts:1815`，在 `sendMessageStream`
内 `:3011` 再跑一次，`client.ts:2315` 还会再跑一次）本来就是为了收尾悬空的 `model[functionCall]`。
本 PR 把这种情形从完成路径挪到了这张安全网上。

**发现 3 —— Nit。回归测试可以再钉牢一点。**

它只断言 promise 被 reject。M3 表明 reject 的**原因**没有任何测试固定，尽管「与 `abortHandler`
用同一段文案」在 issue 讨论里是有意为之的选择。两条额外断言可以把本 PR 确立的契约锁住：

```ts
await expect(queuedSchedule).rejects.toThrow('Tool call cancelled while in queue.');
expect(onAllToolCallsComplete).not.toHaveBeenCalled(); // 请求被丢弃，而不是被 drain
```

不阻塞。

---

### 结论

**建议合并。** 改动是三行，落在唯一缺少预 abort 检查的分支上；有一条在 base 上因正确原因失败的测试
守着；位置可证是唯一正确的（M2）；没有任何套件回归。唯一希望先定下来的是发现 1，而那是关于 #11148
落地顺序的决定，不是关于这个 diff 本身。

<sub>Harness、变异体与原始日志：`r1-core-real.mjs`（真实 dist + 真实 `Config`）、`r6-soak.mjs`，
以及驱动真实 `CoreToolScheduler` 的真实 hook 探针。以上每一个数字都来自本机实跑，两个 arm 均从零构建。</sub>
