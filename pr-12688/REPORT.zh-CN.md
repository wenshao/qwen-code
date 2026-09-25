## 维护者验证 —— PR #12688 @ `3b49c69`（已在 `e3add752` 复核）

验证过程中 head 移动到 `e3add752`，改动只是把 `client.ts` 里的 `'advisor'` 字面量换成 `ToolNames.ADVISOR`，行为等价，并解决了 triage 第 3 点。我在新 head 上重建，复跑了启动矩阵、§2 的运行时场景、PR 集成测试（6/6）以及 core advisor/config 单测（849/849），结果完全一致。下文补丁可干净应用到 `e3add752`。

**结论：修一处小问题后可合入。** Triage 发现 1 真实存在，而且比描述的更严重：手工写错的 `advisorMaxUses` 会让 CLI 起不来，**Advisor 关闭时也一样**；在 `qwen serve` 下，同一个值会让每次 `POST /session` 都返回语义不明的 500。附已验证补丁（+80/−11）。其余我实测的行为都与 PR 描述一致，均为真实构建、两臂对比：executor 与子代理共享上限、并行调用时同步预留、workspace 限制、子代理工具门控、daemon 路径、自由文本渲染、次数耗尽后任务继续。供合并判断的两点：PR 自带的 6 个 CLI 集成场景不在 PR CI 里运行；在真实模型上，新提醒让 head 5 轮中有 3 轮做了完成前检查，但没有一轮做实质工作前的咨询（0/5）。

### 环境

- **两臂。** base `90232f0`（#9636 合入点，即本 PR 的 merge-base）与 head `3b49c69`。各自全新 worktree，`pnpm install --frozen-lockfile`、完整 `npm run build`、`npm run bundle`，均 exit 0。Linux x86_64，Node 22.22.2。PR 的平台表里 Linux 标为"未本地运行"，本报告补上了这一格。
- **确定性场景。** 运行真实 bundled `dist/cli.js`，隔离 `HOME`，workspace 目录独立，使用仓库自带的 `integration-tests/fake-openai-server.ts`。两臂共用同一份脚本化 provider。TUI 与 daemon 对比中，假顾问按 base 强制的结构化输出函数作答，不会让 base 被"人为判错"；headless 上限场景中假顾问用自由文本作答，所以 base 显示 `invalid structured output`，这不影响上限对比。
- **TUI。** 用仓库自带的 `TerminalCapture`（node-pty → 无头 Chromium xterm.js）截取真实 Ink 会话。
- **真实模型。** DashScope `qwen3.8-flash` / `qwen3.8-max`。两臂用同一任务、同一提示词，提示词不提 Advisor。

### 1. 需修复 —— 无效 `advisorMaxUses` 让 CLI 起不来，在 `qwen serve` 下让每个会话都起不来

三臂用同一 settings 文件：设置 `advisorModel`，并在对应作用域写入下表中的值。一次性 `-p` 运行：

| 设置 | base | head | head + 补丁 |
| --- | --- | --- | --- |
| user `advisorMaxUses: 2` | ✅ 正常 | ✅ 正常 | ✅ 正常 |
| user `-1` / `1.5` / `"5"` | ✅ 正常（未知键） | ❌ **exit 1，0 次模型请求** | ✅ 正常 + 告警 |
| system `-1` | ✅ | ❌ exit 1 | ✅ + 告警 |
| user `-1` 且 `advisorModel: "off"` | ✅ | ❌ **exit 1 —— 关闭 Advisor 也崩** | ✅ + 告警 |
| workspace `-1` | ✅ | ✅（本已忽略并告警） | ✅ |
| user `null` | ✅ | ✅ | ✅ |
| 对照：`visionBridgeTimeoutMs: -1` | ✅ | ✅（退化为默认） | ✅ |

head 输出 `An unexpected critical error occurred: Error: advisorMaxUses must be a non-negative integer (0 means unlimited).`，栈为 `new Config` ← `loadCliConfig`。交互式 TUI 以同样方式崩溃（左图）。在 `qwen serve` 下 daemon 能启动，但 `POST /session` 返回 **`500 {"error":"agent channel closed during initialize"}`**，Web Shell 用户无从知道是哪项设置出错。打补丁后返回 `200` 和会话 id。

| head `3b49c69` | head + 补丁 |
| --- | --- |
| ![](t4-invalid-head.png) | ![](t4-invalid-fix.png) |

**补丁**（[`f1-fix.patch`](f1-fix.patch)，+80/−11，4 个文件）：

- core 通过导出的 `isValidAdvisorMaxUses` 把无效值回退为 `0`（不限），与相邻的 `visionBridgeTimeoutMs` 一致，`tryConsumeAdvisorUse` 仍然不会拿到小数或负数上限。
- `getSettingsWarnings` 新增告警 `Warning: advisorMaxUses must be a non-negative integer (0 means unlimited); ignoring -1. Advisor consultations are not limited in this session.` 用户本意是设上限，所以这里的 fail-open 要明示，不能静默。
- PR 的 `rejects invalid Advisor limit` 测试改为 `falls back to unlimited for invalid Advisor limit`（新增覆盖 `'5'`），并新增一条设置告警测试。
- 新增两条钉住测试，补 §5 的变异缺口：`0` 表示不限；新会话重置计数。

补丁校验：core config 的 Advisor 用例 13/13、cli `settings.test.ts` 213/213、core 与 cli 的 `tsc --noEmit` 均无错误、四个文件的 eslint `--max-warnings 0` 与 prettier 均通过，另外重跑了上面的启动矩阵和 serve 探针。回退为 `0` 采纳的是 triage 的建议。如果不希望在成本护栏上 fail-open，可以保留告警、另选回退值，但启动崩溃这一点必须去掉。

### 2. 运行时 A/B（两臂同一脚本化 provider）

| 场景 | base `90232f0` | head `3b49c69` |
| --- | --- | --- |
| 上限 1：executor 咨询后，派生的 `tools: advisor` 子代理再咨询 | 子代理：`Tool "advisor" not found` | 子代理：`Advisor session usage limit reached.`，Advisor 请求共 **1** 次，父代理完成 |
| 上限 2：同流程 | 子代理无法咨询 | 2 次请求；子代理那次含 `CHILD_TASK`、**不含** `PARENT_TASK`；Advisor 请求 0 个工具 |
| 上限 1：**同一条**模型回复里两个 `advisor` 调用 | 2 次请求，均 `invalid structured output`（假顾问用自由文本作答） | **1** 次请求；第二个结果为 `usage limit reached`（await 前已预留） |
| user 上限 1 + workspace `advisorMaxUses: 0` | 无上限 | 1 次请求，第 2 次被拒，并告警 workspace 值被忽略 |
| 仅 workspace `advisorMaxUses: 1` | 无上限（2 次请求） | 被忽略：2 次均放行，并告警 |
| 子代理 `tools: read_file` 尝试 `advisor` | not found | not found；无提醒；0 次请求 |
| 默认工具的子代理 | not found | 已声明 advisor，首轮有提醒，1 次请求 |
| `permissions.deny: ["advisor"]` / `tools.disabled: ["advisor"]` | — | 提醒被抑制（0 份） |
| `-p "/advisor"` | `The command "/advisor" is not supported in this mode.` exit 1 | `Advisor: advisor-model` / `Session calls: 0 / 3` …，exit 0，0 次模型请求 |
| `qwen serve` 会话，上限 1，两次 prompt | 两份结构化评审，无上限 | prompt 1 的建议使用会话 chat（未失败关闭）；prompt 2 返回 `usage limit reached`；共 1 次请求 |
| `qwen serve` 两个 `sessionScope: "thread"` 会话，各自上限 1 | — | 各咨询 1 次：按会话计数，与文档一致 |

PR 自带的 `integration-tests/cli/advisor-tool.test.ts` 在 head 本地 6/6 通过。定向单测：core 1357/1357、cli 484/484、web-shell 85/85。

### 3. 终端 UI（真实 Ink）

同一条建议分别经过两臂：base 渲染强制的四字段卡片；head 渲染自由文本，executor 继续执行：

| base `90232f0` | head `3b49c69` |
| --- | --- |
| ![](t1-advice-base.png) | ![](t1-advice-head.png) |

head，`advisorMaxUses: 1`：第二次咨询不发请求即失败，仍保留 `Advisor advisor-model` 副标题，executor 完成任务：

![](t2-limit-head.png)

原 header 缺陷在 base 上没能复现，默认渲染和 `ui.useTerminalBuffer` 两种模式都试过：挂起 Advisor 请求时，两臂都显示 `Executor Model`（`t3-header-*.png`）。因此 header 改动的依据是作者的截图和 `AppHeader.test.tsx`，后者确实能杀掉回滚变异（M21）。无论如何这处改动无害。

### 4. 真实模型样本 —— 提醒是否改变了行为？

任务：`duration.js`，9 个 `node --test` 用例中 5 个失败，附 `SPEC.md` 契约。提示词：*"Make the tests in this directory pass according to SPEC.md. Run `node --test` to check your work."* 默认启用 Advisor（base：直接声明；head：延迟加载 + 提醒）。每轮产物都独立复跑（9/9），测试文件与规范均未被改动。

| executor / Advisor | base：每轮咨询次数 | head：每轮咨询次数 |
| --- | --- | --- |
| qwen3.8-flash / qwen3.8-max | 0、0、0 | 0、**1（最后一次编辑之后、给出答案之前）**、0 |
| qwen3.8-max / qwen3.8-max | 0、0 | **1、1（都在最后一次编辑之后、给出答案之前）** |

head 5 轮中，完成前咨询出现 3 次（Max 2/2、Flash 1/3），均经 `tool_search select:advisor` → `tool_call advisor`。提醒要求的实质工作前咨询（*"consult before substantive work: writing or editing …"*）为 **0/5**：head 每一轮都先读三个文件、跑测试、完成编辑，然后才咨询。base 虽然直接声明了 Advisor，但从未咨询（0/5），所以完成前检查确实是提醒带来的。

这比作者在最终提交上的样本（Max 在写代码前就咨询）更窄，是补充而非矛盾：在这个任务上，两种搭配都没有在首次编辑前咨询，"便宜执行器 + 强顾问"（可能是最常见的搭配）3 轮中只咨询了 1 次。这与设计文档"不保证每个模型都遵循每个检查点"一致；但在判定 #9036 的时机验收已满足之前仍值得权衡：在我的运行中，工作前检查点并不可靠。

### 5. 测试实际钉住了多少

我对生产改动做了 27 个单行变异，用 PR 自带的定向单测（即 CI 会跑的那些）判分：**19/27 被杀**。存活 8 个，其中 4 个只有 `integration-tests/cli/advisor-tool.test.ts` 能抓到，每个变异我都重建了 bundle 再测：

| 变异 | 单测 | CLI 集成测试 |
| --- | --- | --- |
| M03 `0` 不再表示不限（所有默认用户的首次调用都会被拒） | 存活 | 被杀（3 个用例） |
| M10 Advisor 不再延迟加载 | 存活 | 被杀 |
| M16 executor 收不到提醒 | 存活 | 被杀 |
| M25 `advisorMaxUses` 未透传进 Config | 存活 | 被杀 |
| M02 新会话不重置计数 | 存活 | 存活，补丁新增测试可杀 |
| M08 已中止的 signal 不再抛出；M13 子代理每轮都注入提醒；M14 子代理提醒忽略 allowlist | 存活 | 未覆盖 |

该文件不在 PR CI 中：`Integration Tests (CLI, No Sandbox)` 仅在 merge queue 触发，本 PR 上显示 `skipped`（merge queue 已关闭）；`test:integration:no-ak:sandbox:none` 的清单也不含 `./cli/advisor-tool.test.ts`。它不需要任何凭据，把它加进该清单，M03/M10/M16/M25 就都能进 CI。详见 [`data/mutation-notes.md`](data/mutation-notes.md)。

### 6. 非阻塞观察

- **每轮提醒的成本。** Advisor 提醒长 1,762 字符，在真实端点上用 Qwen 分词器计为 **319 个 prompt token**。它被前置到每个 UserQuery/Cron 轮次并留在历史中，所以第 6 个用户轮的请求带着 6 份副本；长会话在压缩前线性累积，第 3 轮的一次咨询也把这 3 份副本作为 transcript 的一部分转发给了顾问。设计文档的取舍表没有提到这一点。建议每次启用只注入一次（类似日期提醒用 `lastInjectedDate` 去重），至少应把这项成本列为有意差异。
- **交互式 `/advisor` 看不到额度。** TUI 中不带参数的 `/advisor` 打开模型选择器（`t2-picker-head.png`），既不显示已用次数也不显示上限；`Session calls: n / m` 只在非交互与 ACP 模式出现。
- 我认同 triage 的第 2 点（计数对象 `readonly`、在既有 transition 块内就地重置）；第 3 点已在 `e3add752` 修复。

证据（harness、原始 JSON、补丁、全部截图）：[`pr-12688/`](.)
