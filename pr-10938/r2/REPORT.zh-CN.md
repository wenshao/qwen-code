## 本地真实环境验证（第二轮）—— PR #10938 @ `5f70a13`

**建议：修掉一处只在手机宽度出现的小回归后合并。** 第一轮的两个阻断项（R6-3、R7-3）都已修复，在 Chromium 中实测成立。之前仍未关闭的 Critical R8-2 已由 `5f70a13866` 修复：我在 `5c4f1de` 上用真实会话复现了它，在 `5f70a13` 上它已经消失。合并 `main` 没有带来任何回归。

**还剩一处缺陷，由本 diff 引入：** 视口 ≤480px 时，跳过一层的依赖边，其竖线会穿过夹在中间的步骤。这是 R6-3 中关于跨多层边的那一部分，作者因为还没人观察到而暂未处理。在 390px 和 430px 下，`riseX = endX - 24` 处的竖线落在步骤 4 内部 10px，于是步骤 3 → 步骤 5 的依赖看起来像是连进了步骤 4。一个 10 行的候选补丁能消除穿越、让 1440px 下所有路径保持逐字节不变，并通过全部 47 个 `PlanExecutionView` 测试。它只影响手机宽度、且只影响含这类边的计划，所以作为紧随其后的 follow-up 也是合理的。

另外还有一个测试缺口：新 agent 计数里按 `toolUseId` 去重的逻辑没有测试覆盖（变异 M20 能通过测试）。

### 与第一轮相比的变化

- `4860e0a7e6`：修复 R6-3（相邻层边的肩宽）和 R7-3（新增 sr-only 依赖摘要）。
- `5c4f1de9e8`：合并 `main`。merge base 是 `bc7a186`，即当前 `main` 的最新提交。
- `5f70a13866`：在本轮验证进行中（06:23）推送，修复 R8-2。它只改 web-shell 客户端文件，所以我把它单独构建成 bundle，并重跑了所有可能受它影响的检查。

### 环境

本轮复用第一轮的验证环境，worktree 用 `npm ci` 构建（Node 22.22.2，Linux）。所有分支共用**一个**由 `5c4f1de` 构建的真实 `qwen serve` daemon。`5f70a13` 只改客户端代码，所以这个 daemon 同样可以作为新 head 的后端。每个分支是一个静态代理：提供自己的 bundle，把全部 REST 和 SSE 请求转发给这个 daemon。所以**所有分支在同一时刻渲染的是同一批活会话**：

| 分支 | 端口 | bundle |
| --- | --- | --- |
| base | 4939 | 7 个改动源文件与 `bc7a186` 上完全一致（用 `git diff --quiet` 确认） |
| revert | 4940 | 在 `5c4f1de` 上反向应用 `4860e0a7e6`（2 个文件） |
| 上一个 head | 4938 | `5c4f1de`。重新构建出的 bundle 与 daemon 实际提供的哈希一致 |
| **head** | 4943 | `5f70a13` |
| lanefix | 4941 | 上一个 head 加上候选泳道补丁，**不属于本 PR** |

所有会话都是新建的，走真实的 Plan & Review 流程。#11423 之后，批准选项的文案是 **"Approve and execute · Full Access"**。

- **DAG**：5 个步骤分 3 层，一条回程泳道，8 个关联 agent（6 个成功、1 个一直运行、1 个失败）。
- **REVIEW**：同一份计划，不批准，这样审批卡片里显示的是可交互的图。
- **BIG**：50 个步骤、525 条依赖。
- **NEST**：一个关联到步骤 1 的后台 agent，它的 subagent 又启动了一个嵌套 agent，两者都保持运行。

浏览器是由 Playwright 1.58.2 驱动的无头 Chromium。

### 1. R6-3 已修复：各档宽度下箭头都指向目标

对每条相邻层边，我从渲染出的 `[data-plan-edge]` 路径读取终点切线（终点减最后一个控制点）。每个宽度下，三条相邻边的值都相同；`5c4f1de` 和 `5f70a13` 测得的数值也完全一致：

| 视口 | 间隙 | base | revert | **head** |
| --- | --- | --- | --- | --- |
| 1440 | 64px | (28, 0) | (28, 0) | **(28, 0)**，路径未变 |
| 700 | 32px | (28, 0)¹ | (0, 0)，退化 | **(12, 0)** |
| 430 | 18px | (28, 0)¹ | (−14, 0)，反向 | **(5, 0)** |
| 390 | 18px | (28, 0)¹ | (−14, 0)，反向 | **(5, 0)** |

¹ base 的 bundle 没有窄屏档位，任何宽度下间隙都是 64px。

revert 分支精确复现了第一轮测得的数值。变异 M13 把 `Math.max(24, …)` 改回去，新测试 `keeps the arrowhead pointing at the target on every gutter tier` 能抓到它。

![箭头：回滚修复 vs head](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-10938/r2/fig2-arrowheads.png)

### 2. R7-3 已修复：未选中节点重新念出阻塞它的步骤

审批卡片里，边已经画出且为 `aria-hidden`，没有选中任何节点。各分支中步骤 4 的 `ariaSnapshot()`：

- base：`compare-findings Blocked Compare findings and draft the migration plan Depends on: survey-api, read-tests`
- revert：`Blocked 4 Compare findings and draft the migration plan`
- **head：`Blocked 4 Compare findings and draft the migration plan Depends on: 1 Survey the public API surface, 2 Read the existing test suite`**
- zh-CN（在 `5c4f1de` 上测，`5f70a13` 没有改这部分代码）：`被阻塞 4 Compare findings and draft the migration plan 依赖： 1 Survey the public API surface, 2 Read the existing test suite`

这段摘要在视觉上没有任何变化。它的 span 是 `1×1`、`position: absolute`、`clip-path: inset(50%)`。revert 与 head 的审批卡片图截图（966×253）**像素差异为 0**，两边每个节点的高度也相同。每个界面上，依赖都只表述一次：

| 界面 | 可见 chip 行 | sr-only 摘要 |
| --- | --- | --- |
| 审批卡片（画了边） | 0 | 2（步骤 4 和 5） |
| cockpit（`showStepDetails={false}`） | 2 | 0 |
| BIG，525 条依赖（不画边） | 25 | 0 |

变异 M14–M17 全部被测试抓到：删掉摘要、去掉裁剪、用裸 id 代替编号加标题、在可见 chip 旁边也渲染摘要。

### 3. R8-2 已由 `5f70a13866` 修复，真实会话中确认

会话 NEST，cockpit 视图。两个 head 在同一时刻、对着同一个 daemon 渲染：

| 分支 | 节点正面 | 该节点上的 agent 行 | 概览条 |
| --- | --- | --- | --- |
| 上一个 head `5c4f1de` | **`1 agent`** | 2（`Agent: Parent agent`、`↳ general-purpose: Nested probe`） | `2 Active agents` |
| **head `5f70a13`** | **`2 agents`** | 2 | `2 Active agents` |
| base | 正面没有计数 | 2 | `2 Active agents` |

![R8-2：上一个 head vs head](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-10938/r2/fig3-r8-2-agent-count.png)

触发条件很普通：一个后台 agent，它的 subagent 调用了 `agent`。嵌套默认开启（`DEFAULT_MAX_SUBAGENT_DEPTH = 5`），`general-purpose` 也继承了 `agent` 工具。嵌套的子 agent 以带 `parentAgentId` 的实时任务出现，但父工具调用的 `subTools` 里没有对应条目。这正是评审描述的"有实时任务、但 transcript 里没有对应条目"的情形。

推送之前，我已经把作者在 thread 里提出的补丁单独构建成 bundle，它同样显示 `2 agents`。推送的提交与之代码相同，只差一个变量名。

`5f70a13` 上的测试情况：

- 原有装置现在期望 `2 agents`。
- 新测试 `the node-face agent tally matches the rows it renders` 覆盖了"没有 transcript 条目的实时子 agent"，并让单数形式（`1 agent`）继续有测试覆盖。
- 变异 **M19**（计数改回只读 transcript）和 **M21**（不计实时子任务）都被测试抓到。
- 变异 **M20** 去掉了按 `toolUseId` 去重，于是同时以实时任务和 `subTools` 条目出现的 agent 会被计两次，但**它仍能通过全部 41 个测试**。去重逻辑存在，只是没有测试。我尝试用前台变体在真实会话中制造这种重叠：根 agent 在前台运行，它的 subagent 调用 `agent`。嵌套 agent 自己的模型请求确实发出了，但两个 head 都完全没有显示它（1 行、`1 agent`、概览条 1），所以无法从界面上走到重叠情形。因此 M20 是测试缺口，而不是已观察到的缺陷。补一个装置，让实时任务的 `toolUseId` 与 transcript 的 `subTools` 条目相同，并断言只计一次，即可补上。

### 4. 剩余缺陷：≤480px 时回程泳道从两端之间的步骤中穿过

跨越多层的边，路由仍然使用固定的 24px 肩宽：`PlanExecutionView.tsx` 里的 `dropX = startX + 24` 和 `riseX = endX - 24`。18px 间隙只留下 10px 的水平跨度，所以竖线落进了相邻那一列节点内部 6px。

在 390px 的 DAG 会话中，边 `check-docs → write-summary`（步骤 3 → 步骤 5）在 x=246 处竖直上升，而步骤 4 的范围是 x=140–256。这段竖线与步骤 4 重叠了 106px，而且 SVG 绘制在节点下层。于是蓝色泳道一路升进步骤 4 的底边就消失了，在手机上看起来像是步骤 4 的依赖。在 `5f70a13` 上测得：

- 390px 和 430px：穿越完全相同。
- 700px（32px 间隙）：竖线离步骤 4 还有 4px。
- 1440px：离步骤 4 有 36px。
- base：从不穿过，因为它的间隙始终是 64px。
- 下降段的几何关系完全相同：390px 下 x=150 落在第 2 层的范围内。这里没有碰到节点，只是因为第 2 层恰好只有一个节点。

![390px 泳道穿越：head vs 候选补丁](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-10938/r2/fig1-lane-crossing.png)

候选补丁在 `patches/lanefix-candidate.patch`（+24/−10），**不属于本 PR**。它和相邻边已有的做法一样，按每一侧实测的间隙推导肩宽，并缩小转角半径，让曲线仍然放得下：

```ts
const dropShoulder = Math.min(24, dropRun / 2); // dropRun = 下一层左边界 − 4 − startX
const riseShoulder = Math.min(24, riseRun / 2); // riseRun = endX − (上一层右边界 + 4)
const corner = Math.min(EDGE_CORNER, dropShoulder / 2, riseShoulder / 2);
```

在同一会话上实测：

- **1440px**：4 条路径与 head 逐字节相同。
- **700px**：竖直上升段从 x=426 移到 438，下降段从 250 移到 238，都位于各自间隙的中线。
- **390px**：上升段在 265（间隙 256–274），下降段在 131（间隙 122–140）。430px 相同，只是整体偏移 5px。没有任何穿越，末端切线为 (2.5, 0)。
- **测试**：`PlanExecutionView` 测试 47/47 通过。

第一版补丁用的是 `corner = min(6, shoulder)`，在 18px 间隙下末段长度会变成 0，所以转角半径要再减半。补丁只动路由代码，在 `5f70a13` 上可以原样应用。

### 5. 合并 `main` 之后，第一轮的结论

在 `5c4f1de` 上测。`5f70a13` 只改了 agent 计数，而 DAG 会话里没有嵌套 agent。第一轮测过的所有数值仍然成立：

| 结论 | 第二轮 |
| --- | --- |
| 节点正面 | `1 Survey the public API surface` / `✓ 3 agents 10s`；`3 Check the docs…` / `◐ ! 2 agents 4s` |
| 状态竖条对比度 | 深色 8.01 / 5.9 / 12.05；浅色 5.38 / 7.2 / 4.73；blocked 和 ready 为透明 |
| 端口点 | 没有输入端口；输出端口用细线色 |
| 选中的 blocked 节点 | `3px transparent`。强制改成选中环颜色后变为 `3px oklch(0.708 0 0)`，说明这条保护规则是必要的 |
| cockpit 依赖导航 | `5 Write…` 选中 `write-summary`，再点 `4 Compare…` 选中 `compare-findings` |
| 审批卡片 Step details | 3 个 `<button data-plan-dependency data-plan-interactive>`，上下游两个方向点击都能选中对应步骤 |
| Show all | `Show all 8 runs` 单行显示、`display:block`，展开为 8 行。删掉它的两条样式规则后折成 3 行（77px） |
| 窄视口泳道 | 700px 放得下（676 = 676），430px 放得下，414px 溢出 6px，390px 溢出 30px |
| 依赖 > 500 条 | 不画边，显示提示；25/25 个叶子节点显示 chip |
| 控制台和页面错误 | 所有分支、所有场景都是 0 |

![5c4f1de 上的 cockpit](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-10938/r2/fig4-cockpit-head.png)

### 6. 静态检查、测试与 CI

| 检查 | `5c4f1de` | **`5f70a13`** |
| --- | --- | --- |
| `tsc -p packages/web-shell/tsconfig.json --noEmit` | ✅ 0 个错误 | ✅ 0 个错误 |
| 对改动的 TS/TSX 文件跑 `eslint` · 对全部改动文件跑 `prettier --check` | ✅ · ✅ | ✅ · ✅ |
| `vitest run client/components/messages/PlanExecutionView client/components/workflow` | ✅ 87 个用例 | ✅ **88 个用例** |
| web-shell 全量 `vitest` | ✅ 311 个文件、7691 个用例 | ✅ 311 个文件、**7692** 个用例 |
| 变异测试 | 18 个变异，17 个被抓到，**M7** 仍能通过 | 另加 3 个：M19、M21 被抓到，**M20** 仍能通过 |
| CI | 全绿（Lint & Static、Test、web-shell E2E Smoke、visuals、Integration、Desktop Shell） | Lint & Static、Integration (no-AK)、Desktop Shell 已通过；发布本报告时 Test (ubuntu) 和 web-shell visuals 仍在运行 |

`5c4f1de` 上的 87 个用例，是作者的 84 个加上 #11434 通过 `main` 带进来的用例。作者本机看到的 353 个 `tsc` 错误，是因为缺少 `@qwen-code/sdk` 的 dist；完整跑过 `npm ci` 之后，`tsc` 的退出码为 0。

### 第一轮遗留项

作者有意推迟了这些，都不阻断合并。

- 依赖超过 500 条时 chip 行没有上限：`leaf-1` 在 head 上高 554px，在 base 上是 153px。
- `PlanExecutionView.module.css:249-250` 的注释仍写着 390px 手机"最后约 6px 需要滚动"，实测溢出是 30px。PR 描述里的数字已经改对了。
- 激活依赖链接或 "Show all" 后，焦点掉到 `<body>`（D9-3）。
- 静息状态（ready 或 blocked）的节点没有左侧细线，属于设计取舍。
- 变异 M7 仍然能通过测试。

### 未覆盖

- macOS 和 Windows。
- zh-CN 的视觉渲染：只检查了无障碍名称。
- 经由 Plan & tasks 对话框的路径。
- 新 agent 计数的重叠情形（见第 3 节）：无法从界面上走到。

图、原始截图、JSON、日志、补丁和验证脚本都在 [`asserts/pr-10938/r2`](https://github.com/wenshao/qwen-code/tree/asserts/pr-10938/r2)。
