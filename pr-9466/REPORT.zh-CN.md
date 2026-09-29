## 维护者验证（第 2 轮）—— 在 Linux 上对 `35f9500588` 做真实 TUI A/B

**结论：我这边认为可以合入。** 在真实终端里，head 修复了 `main` 上 4 个用户可见的 rewind 缺陷。它改动的路径里我没有发现回归。PR 已经写明的两处行为变化（经 Ctrl+Y 重试的回合、本 PR 之前写出的 checkpoint）都会在动任何东西之前 fail closed。下面给出实测数据，方便 triage 转交时要求的签字基于数据来做。另附一个可选的纯测试补丁（+62/−1），补上变异检查发现的 3 个覆盖漏洞。这 3 个都不是生产缺陷。

<sub>第 1 轮（2026-08-24，head `2755034d`，[评论](https://github.com/QwenLM/qwen-code/pull/9466#issuecomment-5394148067)）已作废：那个 head 已不存在。本轮在当前 head、以及与今天 `main` 的本地合并上全部重新构建。</sub>

### 做了什么

- **两臂均从源码构建**：base = merge-base `d63a5ed61c`，head = `35f9500588`。每臂执行 `pnpm install --frozen-lockfile`、`npm run build`、`npm run bundle`，全部 exit 0。第三臂是 head 与当前 `main` `2f5a62e6ab`（领先 35 个提交）的本地合并。
- **真实 TUI**：`dist/cli.js` 跑在 node-pty 里，由 headless Chromium 的 xterm.js 渲染（即仓库自带的 `integration-tests/terminal-capture`）。每次运行使用独立 `HOME`，两臂按键完全相同。双击 `Esc` 打开的是真正的 rewind 选择器。
- **脚本化的 OpenAI 兼容假模型**，记录每一个请求。屏幕上的 `CONTEXT CHECK` 行由假模型根据回退之后**实际收到的请求体**计算得出，因此反映的是**模型侧历史**，而不是 UI 渲染。
- S1–S6 的每个 A/B 单元格都**跑了两遍**（2/2 一致），S7 也跑了两遍。S1、S2、S4 还在 **PR + `main` 合并**构建上重跑，结果一致。

### 场景矩阵

| # | 场景（两臂脚本相同） | base `d63a5ed61c` | head `35f9500588` |
|---|---|---|---|
| S1 | 实时会话：T1 启动后台 shell（其 `<task-notification>` 以 `user` 条目进入模型历史）· T2 写 `b.txt` · T3 写 `c.txt` · 回退到 T3 → *Restore code and conversation* | ❌ 文件正确，但模型上下文 = **`[T1]`**。T2 被静默丢弃，屏幕上却仍显示 T2 | ✅ `[T1, T2]` |
| S2 | 同上，然后 `/quit` → `qwen --continue` → T4 写 `d.txt` → 回退到 T3（位于 resume 进来的区间） | ❌ 只提供 *Restore conversation only*，`c.txt`/`d.txt` 留在磁盘上；上下文 `[T1]` | ✅ *Restore code and conversation (+2 −0 in 2 files)*，只剩 `b.txt`；`[T1, T2]` |
| S6 | 与 S2 相同，但用 `qwen --continue --fork-session` | ❌ 与 base S2 相同 | ✅ 与 head S2 相同。fork 后记录/快照重映射为 `<new>########0..2`，fork 后第一个回合铸造 `########4`（无冲突；快照 key 与记录 id 一致） |
| S7 | resume 后的会话：回退到自定义命令（`.qwen/commands/greet.md`）提交的那条 prompt | ❌ 上下文 `[T1, T2]`：所选回合**没有**被移除 | ✅ `[T1]` |
| S7L | 实时会话，同一自定义命令，回退到 `/greet` | ✅ `[T1]` | ✅ `[T1]`（没有误拒） |
| S8 | resume 后回退到一个 `@README.md` 回合 | ✅ `[T1]` | ✅ `[T1]` |
| S5 | 在 T2 与 T3 之间 `/compress`（摘要式）· 回退到 T1 · 回退到 T4 · 退出 · resume · 回退到 T5 | ✅ "已压缩"拒绝 · `[summary, T3]` · `[summary, T3]` | ✅ 完全一致，拒绝文案仍然是"已压缩" |
| S11 | 发送 T3 时触发 soft 档自动压缩 · 退出 · resume | ✅ T3 的问题在 resume 后保留 | ✅ 一致。压缩记录另外带上了 `promptIds: [null, null, …########2]` |
| S3 | default 审批模式下 `/restore` T3 的 JSON checkpoint → 回退到 T2 | ✅ `[T1]`，只剩 `a.txt` | ✅ `[T1]`，只剩 `a.txt`。checkpoint JSON 带有 `promptIds`（11 项，与 `clientHistory` 平行；id 位于 3 个用户 prompt 槽位 1/5/9） |
| S3′ | 同一 checkpoint 删掉 `promptIds`（等同本 PR 之前写出的） | — | ⚠️ `/restore` 仍能恢复文件。对话回退在**触碰任何文件之前被拒绝**，对话与文件都不变（已在 PR 中说明） |
| S4 | T2 首次失败（HTTP 400）→ Ctrl+Y → T3 · 回退到 T3 · 再回退到被重试的 T2 | ✅ `[T1, T2]` · ✅ `[T1]` | ✅ `[T1, T2]` · ⚠️ T2 **被拒绝**（"no longer matches the model history (for example, after a retry)"），不截断任何内容（已在 PR 中说明） |
| S10 | **由 base 写出**的会话被 head resume，回退到 T3 | — | 行为与 base 完全相同（只能恢复对话，`[T1]`） |

S10 是给悬而未决的 R49-1 裁定用的数据点。没有持久化身份的回合**原样**保留 `main` 的位置映射行为：head 不会让它们变差，而且这类会话里的新回合会获得身份。因此残余风险是"升级前的会话不会被追溯修复"，也就是延后到 #9437 的含义，而不是回归。

### 证据

![S1 实时通知 A/B](01-live-notification-ab.png)

![S2 resume A/B](02-resume-ab.png)

![S7 resume 后自定义命令 A/B](06-resumed-custom-command-ab.png)

更多图（S6 fork-session、S4 重试取舍、S3 checkpoint 取舍）见上方英文部分的折叠块，或本目录。

### 两处已声明的取舍，实测结果

1. **经 Ctrl+Y 重试的回合（S4）。** 只影响被重试的那一个回合：其后的回合正常解析，拒绝时也不截断任何内容。base 在这个场景下是正确的。原因是 `SendMessageType.Retry` 按设计以无标记方式发送（`client.ts`），而 UI 项仍带着原身份。**可作为后续（不阻塞）：** 把失败回合的身份带入重试发送。失败那次的条目在重试前已被剥离（实测重试后模型历史里恰好只有一条 T2），因此重新打标记后的条目仍然唯一。
2. **本 PR 之前写出的 checkpoint（S3′）。** `/restore` 的文件恢复照常可用。只有在*恢复出来的区间内*做对话回退会被拒绝，且只针对升级前创建的 checkpoint。小问题：拒绝文案写的是 "for example, after a retry"，对这个原因略有误导，不阻塞。

### 变异检查（针对生产 diff 手写 31 个变异体）

- **现有测试杀死 27/31。** M28（API 侧重复标记解析到第一个匹配）只能**跨包**被杀：用该变异重建 core `dist` 后，cli 的 `historyMapping` 重复身份用例能抓住它。我之后恢复了 core `dist`，sha256 逐字节一致。
- 4 个存活：

| 变异 | 存活的改动 | 状态 |
|---|---|---|
| M07 | checkpoint 写入侧（`use-llm-stream.ts`）不再输出 `promptIds` | 无单测（PR 已披露）。端到端已覆盖：S3 检查了写出的 JSON，S3′ 正是该变异在运行时的效果 |
| M09 | resume 后的 `@` 命令回合丢失 `promptId`（`resumeHistoryUtils.ts` 的 at-command 分支） | 下方补丁可杀 |
| M15 | stacked skill 的调用项未打身份（`slashCommandProcessor.ts` 第一处 `updateItem`） | 下方补丁可杀 |
| M27 | 从压缩快照 resume 时不再按 `promptIds` 重新打标记（`session-api-history.ts`） | 下方补丁可杀。**现有 llm-chat 的 "round-trip" 用例对这一行是空转的**：它把内存里带 Symbol 标记的对象直接交给 `buildApiHistoryFromConversation`，而 `copyContentForApiHistory` 用的是 `{...content}`，会把自有 Symbol 键一起拷过去。真实的 JSONL 边界会丢掉这些键。修法是让 payload 先过一遍 `JSON.parse(JSON.stringify(…))` |

可选的纯测试补丁（+62/−1，3 个文件）：[`pin-tests.patch`](data/pin-tests.patch)。在 head 上全部通过（cli 198/198、core 535/535），在对应变异上各失败 1 条；prettier 与 eslint 均干净。

### 门禁

- head 上本 PR 触及的 20 个测试文件：**3527/3527**（core 8 个文件 1567 条；cli 12 个文件 1960 条）。PR + `main` 合并：**3545/3545**。
- `npm run typecheck` 在 head 与合并上均 exit 0。`eslint --max-warnings 0` 覆盖全部 48 个改动文件：0。`prettier --check`：干净。
- 与 `main` 的合并在文本上无冲突。有 7 个文件与 main 的新提交重叠。我检查了合并树中 `recordUserMessage(…, promptPayload, promptId, daemonPromptId)` 的位置参数插入：3 个非测试调用点的参数顺序都正确。

### 未覆盖

macOS 与 Windows。ACP/IDE rewind 的端到端（只有单测：`Session.test.ts` 1072 条，其中 25 条杀死 M16）。OpenTUI（本 PR 中没有 rewind 入口）。hard 档自动压缩的端到端：用合成 usage 时两臂都会以 inflated 判定压缩失败，所以这处改动只由 M18 的单测钉住。真实 provider：这里假模型已经足够，因为被测行为是客户端自身的历史记账，假模型如实反映客户端发出的内容。

### 既有问题，不在本 PR 范围（两臂相同）

- 交互式 TUI 中的 `/branch` 总是被拒绝（"Cannot branch while a response or tool call is in progress…"），即使是在空闲的单回合会话里。PR 说明中标注为"未改变"，我没有找到跟踪 issue。这也是上面 fork 路径改用 `--fork-session` 驱动的原因。
- resume 后，rewind 选择器会把自定义命令列两次：`/greet` 以及它展开后的 prompt。

证据（脚本、每次运行的 `result.json`、变异结果、补丁）：this directory (`harness/`, `data/`)
