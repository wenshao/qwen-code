# PR #13324 维护者验证（第二轮，head 5fc8a82ce6）

**结论：`5fc8a82ce6` 可以合并。** 在 Linux 上用真实打包 CLI 驱动的每个入口（headless、Ink TUI、OpenTUI、ACP 回放、`/export`、`--resume`）都表现出 PR 所述的生产行为。

本轮在上一个 head `cfdfa97a73` 上发现一个阻断项：它无法编译，7 个 CI 任务因此失败。作者同时推送的 `f17ece2151` 用与我本地验证过的相同的测试修改修复了它。下面所有结果都已在新 head 上重新运行。

- 验证 head：`5fc8a82ce6bb6a9eb7d4cb886f96b594c7b5edf1`，它合并了 main `05ebb1ef3e`，并加入 `f17ece2151`。
- PR 自身改动（`05ebb1ef3e..5fc8a82ce6`，31 个文件）与我在 `cfdfa97a73` 上验证的改动（`691a374d2a..cfdfa97a73`）逐行一致，唯一差别是 `f17ece2151` 的 fixture 修复。
- A/B base：`691a374d2a`。它仍是有效对照，因为 main 的 `691a374d2a..05ebb1ef3e` 没有触及 Goal、Code Mode、记录、回放、导出、TUI 恢复或 IDE companion 路径，也没有新增 `tool_result` 读取器。
- 试合并到当前 `origin/main`（`98b0255f9d`）：干净（`git merge-tree --write-tree`，exit 0）。

这是我的第二轮验证。第一轮在 `2013078bdc`（[评论](https://github.com/QwenLM/qwen-code/pull/13324#issuecomment-5975041507)），结论是在集成测试层面可以合并。本轮针对此前各轮（我的第一轮和 [CI verify lane](https://github.com/QwenLM/qwen-code/pull/13324#issuecomment-5977897360)）留下的空白：Linux 环境、真实打包 CLI 的全部入口、跨版本读取器，以及全仓 typecheck/build；同时覆盖之后的提交 `16c3553015`、`01ed707dc1`、`cfdfa97a73` 和 `f17ece2151`。

## Linux 真实打包 CLI：base 与 head 发给 verifier 的内容对比

两臂使用同一份确定性 loopback provider 脚本。第一个 `exec` 脚本依次回显 `get_goal`、静默读取 `fact.txt`、在 `try/catch` 中读取 `missing.txt`、输出编造的 `"Claim: fixture overwritten and 999 tests passed."`、计算 `6 * 7`；第二个 `exec` 调用 `update_goal`。判据是真实 Goal verifier HTTP 请求里的 `evidence` 数组。运行环境为隔离的 `HOME`、`tools.codeModeOnly: true`，headless 使用默认审批模式。

| 观察项（headless `-p "/goal …"`） | base `691a374d2a` | head `5fc8a82ce6` |
| --- | --- | --- |
| 发给 verifier 的 proofKind | `external_fact` ×2 | `execution_output` ×2、`external_fact` ×2 |
| 编造的 "999 tests passed" 以 `external_fact` 出现 | **是** | 否 |
| Goal 元数据回显以 `external_fact` 出现 | **是** | 否 |
| 真实文件内容（静默读取）以 `external_fact` 出现 | **否** | 是 |
| 被吞掉的文件不存在错误以 `external_fact` 出现 | **否** | 是 |
| verifier 仍能看到 `42` | 是 | 是（作为 `execution_output`） |
| JSONL 中的 `tool_result` 记录（外层 / 内部） | 2 / 0 | 2 / 4；内部记录为 `code_mode_tool_result`，全部带 Goal 归属；`get_goal`/`update_goal` 为 `goal_runtime` |
| 新进程 `--resume` 一轮：provider 请求中的孤立 tool 消息 | 0 | 0（只有配对的外层 id `call_work_1`、`call_propose_2`） |
| Goal 最终状态 / 进程退出码 | complete / 0、0 | complete / 0、0 |

交互式 Ink TUI 路径（node-pty 下运行真实 bundle）得到同样的分化。base 发送 `{external_fact: 2}`，编造声明落在 `external_fact` 中；head 发送 `{execution_output: 2, external_fact: 2}`，编造声明不进入 `external_fact`。该路径中，外层结果由 `use-llm-stream` 记录，内部结果经 scheduler 仅在 Goal 回合启用的 recorder fallback 记录；head 的 JSONL 中两者的 subtype 与 provenance 均符合预期。

## 同一份 head 写出的会话，分别用两个真实二进制读取

| 读取方式 | base 二进制 | head 二进制 |
| --- | --- | --- |
| ACP `--acp` → `session/load`：`tool_call` / `tool_call_update` | 3 / 7 | 3 / 3 |
| ACP 未宣布的完成消息 | **4**（`call_work_1:code:1..3`、`call_propose_2:code:1`） | 0 |
| `/export json`：消息数 / 工具调用数 | 14 / 7（4 个幻影 `:code:` 调用） | 10 / 3 |
| `--resume` 一轮：发给 provider 的孤立 tool 消息 | 0 | 0 |

head 一列说明读取器修复在真实二进制上生效。base 一列量化了 PR 已声明的降级代价：旧客户端会把内部记录回放、导出成幻影工具调用，但恢复给模型的历史仍然干净。我不认为这应阻断合并，但建议写进发布说明。

## TUI（Ink 与 OpenTUI）

head 上的 Ink：实时 `/goal` 运行和新进程 `--resume` 都只显示两张外层 Exec 卡片，4 条内部记录不增加任何行。base 渲染相同的画面，文本差异只有工作区路径和 Goal id。

OpenTUI 在 bun 1.3.14 下运行，并设置了 `QWEN_TUI_RENDERER=opentui` 与 `QWEN_TUI_RENDERER_STRICT=1`，因此不会静默回退到 Ink。用 head 或 base 二进制恢复同一份 head 写出的会话，都显示两张 Exec 卡片，两张画面只差一条临时的更新检查提示。这以实测关闭了 CI verify lane 关于 `opentui/transcript-adapter.ts` 不识别 subtype 的开放问题：目前内部记录不会被绘制。

## 本轮发现并已修复：`cfdfa97a73` 无法编译

`01ed707dc1` 在 `DataProcessor.test.ts:1319` 和 `:1332` 新增的 fixture 不是合法的 `FileDiff`。vitest 会剥离类型，所以测试显示 52/52 通过；但 `npm run build` 和 CI `prepare` 中执行的 `tsc --build` 在这两行都报 `TS2740`。本地 `npm run build` 在 `packages/cli` 处 exit 1，`npm run typecheck` exit 2。

CI 上，`cfdfa97a73` 的每个失败任务第一条错误都是它：Lint & Static、Test (ubuntu)、Integration Tests (no-AK)、TUI parity snapshots、OpenTUI no-flicker gate、Real daemon E2E / Java 11、Hosted process fault gates / MySQL 8.4。这 7 个任务在 `16c3553015` 上都是绿的。

`f17ece2151` 补全了这两个 fixture。在它推送之前，我已在本地验证过同样的写法：全仓 typecheck 和 build exit 0，删掉守卫后测试仍会变红。在 `5fc8a82ce6` 上：

| 门禁 | 结果 |
| --- | --- |
| 根目录 `npm run typecheck`（全部 workspace 加集成测试） | exit 0 |
| 根目录 `npm run build` / `npm run bundle` | exit 0 / exit 0 |
| `DataProcessor.test.ts` | 52/52 通过 |
| 变异：删掉 `DataProcessor.ts` 中的 `subtype` 守卫 | 1 失败 / 51 通过，fixture 仍锁定该守卫 |
| 目前的 CI | TUI parity snapshots 与 OpenTUI no-flicker gate：success（在 `cfdfa97a73` 上两者都是红的）。发帖时其余车道仍在运行。 |

## head `5fc8a82ce6` 上的门禁

| 门禁 | 结果 |
| --- | --- |
| 14 个改动测试文件（core 8 / acp-bridge 1 / cli 4 / vscode 1） | 190 + 145 + 157 + 14 = **506 通过** |
| 29 个改动 `.ts` 文件 ESLint `--max-warnings 0`（活性：植入未使用变量后 exit 1） | exit 0 |
| 31 个改动文件 Prettier | 干净 |
| 根目录 `npm run typecheck` / `npm run build` / `npm run bundle` | exit 0 / 0 / 0 |
| bundle 身份核对 | head `dist/` 含 `code_mode_tool_result`（5 个文件），base 为 0 |
| 变异：删掉 `qwenAgentManager.ts` 中的 `r.subtype !== 'code_mode_tool_result'`（`01ed707dc1`） | 被杀死（14 中 1 失败） |
| 变异：删掉 `coreToolScheduler.ts` 中的 `&& call.request.goalContext`（R2-3 修复 `cfdfa97a73`） | 被杀死（20 中 1 失败） |

## 此前各轮遗留（不阻断）

- **CI verify lane 提出的 M2 与 M10 仍然存活。** 我分别单独回退，跑 8 个改动的 core 测试文件，两次都是 190/190 全绿。这些测试文件在 `5fc8a82ce6` 上逐字节不变，也没有提交处理它们。它们是覆盖率建议，不是缺陷。在我驱动的 OpenAI 兼容链路上，`exec` 结果总带有 id 和 `exec` 响应名，因此即使去掉 M2 子句，名称/id fallback 也能正确分类。
- R2-1（为 subtype 判定设立单一归属）已由作者推迟到 #13394。

## 未覆盖

- Windows 与 macOS 本地执行。本轮只在 Linux 上运行（Node 22.22.2、bun 1.3.14）；本 PR 上 CI 的 macOS/Windows Test 车道被跳过。
- 真实模型的语义裁决。假 verifier 无条件接受；本轮验证的是输入给它的确定性分类与记录。
- 原生 ACP Code Mode 的 *prompt* 回合（#13378 的范围），以及 managed/daemon（`serve`）路径。ACP 只通过 `session/load` 回放验证。
- 全仓测试。只运行了 14 个改动的测试文件。

## 方法

三个 `git worktree`（base `691a374d2a`、早先的 head `cfdfa97a73`、最终 head `5fc8a82ce6`），各自执行 `pnpm install --frozen-lockfile`、`npm run build`、`npm run bundle`。确定性的 OpenAI 兼容 loopback provider 同时扮演 worker 与 Goal verifier，按 system prompt 区分请求，并记录每个请求体。headless、ACP 和 `/export` 由脚本驱动；TUI 在 node-pty 下运行，由 xterm.js 渲染。读取器 A/B 让两个二进制指向同一份复制出的 `HOME`。本 head 的证据见 [`pr-13324-5fc8a82ce6/`](.)；早先 `cfdfa97a73` 那一轮（含编译错误日志）见 [`pr-13324`](../pr-13324)。


## 截图

![Real CLI A/B on the verifier wire](01-real-cli-verifier-evidence-ab.png)

![One head-written session read by each binary](02-reader-compat-same-transcript.png)

![Ink and OpenTUI on the same session](03-tui-ink-and-opentui-resume.png)

![Build break found and fixed](04-build-break-found-and-fixed.png)
