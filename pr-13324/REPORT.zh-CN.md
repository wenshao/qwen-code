# PR #13324 维护者验证（第二轮）

**结论：`cfdfa97a73` 暂不可合并。有一个阻断项，下面给出的仅改测试的修复已验证。** 在 Linux 上用真实打包 CLI 驱动的每个入口都表现出 PR 所述的生产行为。阻断项是 `01ed707dc1` 新增测试中的编译错误：它让当前 head 上 7 个 CI 任务变红，这些任务在 `16c3553015` 上都是绿的。

验证 head：`cfdfa97a73e2cddb0800433af3441cf52d5852fc` · A/B base：merge-base `691a374d2a` · 试合并到当前 `origin/main`（`6694f35499`，领先 19 个提交，均未触及 PR 文件）：干净（`git merge-tree --write-tree`，exit 0）。

这是我的第二轮验证。第一轮在 `2013078bdc`（[评论](https://github.com/QwenLM/qwen-code/pull/13324#issuecomment-5975041507)），结论是在集成测试层面可以合并。之后 PR 新增了 `16c3553015`（读取器兼容）、`01ed707dc1`（insight 与 IDE companion 读取器）和 `cfdfa97a73`（scheduler 测试的正向对照）。本轮针对此前各轮（我的第一轮和 [CI verify lane](https://github.com/QwenLM/qwen-code/pull/13324#issuecomment-5977897360)）留下的空白：Linux 环境，真实打包 CLI 的全部入口（headless、Ink TUI、OpenTUI、ACP、`/export`、`--resume`），跨版本读取器，以及全仓 typecheck/build。

## 阻断项：head 无法编译

`01ed707dc1` 新增的 `packages/cli/src/services/insight/generators/DataProcessor.test.ts:1319` 与 `:1332` 把 `resultDisplay` 写成 `{ fileName, diffStat: { model_added_lines, model_removed_lines } }`。它不是合法的 `FileDiff`：`diffStat` 缺少 6 个必填的 `DiffStat` 字段，对象本身也没有 `fileDiff`/`originalContent`/`newContent`。vitest 会剥离类型，所以测试显示 52/52 通过；但 `npm run build` 和 CI `prepare` 里执行的 `tsc --build` 会失败（TS2740，两处）。

本地复现：根目录 `npm run build` 在 `packages/cli` 处 exit 1，根目录 `npm run typecheck` exit 2，报错正好是这两处。CI 上，`cfdfa97a73` 的每个失败任务第一条错误都是它：Lint & Static、Test (ubuntu)、Integration Tests (no-AK)、TUI parity snapshots、OpenTUI no-flicker gate、Real daemon E2E / Java 11、Hosted process fault gates / MySQL 8.4。这 7 个任务在 `16c3553015` 上都是 `success`。

```
src/services/insight/generators/DataProcessor.test.ts(1319,15): error TS2740: Type '{ model_added_lines: number; model_removed_lines: number; }' is missing the following properties from type 'DiffStat': model_added_chars, model_removed_chars, user_added_lines, user_removed_lines, and 2 more.
src/services/insight/generators/DataProcessor.test.ts(1332,15): error TS2740: (same)
```

**建议的修复（只改测试，已验证）：** 在该测试里构造完整的 `FileDiff` fixture。

```ts
const fileDiff = (fileName: string, added: number, removed: number) => ({
  fileDiff: '',
  fileName,
  originalContent: null,
  newContent: '',
  diffStat: {
    model_added_lines: added,
    model_removed_lines: removed,
    model_added_chars: 0,
    model_removed_chars: 0,
    user_added_lines: 0,
    user_removed_lines: 0,
    user_added_chars: 0,
    user_removed_chars: 0,
  },
});
// resultDisplay: fileDiff('/workspace/direct.txt', 2, 0)
// resultDisplay: fileDiff('/workspace/nested.txt', 12, 2)
```

| 在 `cfdfa97a73` 上打上修复后 | 结果 |
| --- | --- |
| `npx tsc --noEmit`（packages/cli） | exit 0 |
| 根目录 `npm run typecheck`（全部 workspace 加集成测试） | exit 0 |
| 根目录完整 `npm run build` | exit 0 |
| 该文件的 ESLint `--max-warnings 0` / Prettier | 干净 |
| `DataProcessor.test.ts` | 52/52 通过 |
| 变异：删掉 `DataProcessor.ts` 中的 `subtype` 守卫 | 1 失败 / 51 通过，修复后的测试仍然锁定该守卫 |

完整补丁见 [`data/suggested-fix.patch`](./data/suggested-fix.patch)。

## Linux 真实打包 CLI：base 与 head 发给 verifier 的内容对比

两臂使用同一份确定性 loopback provider 脚本。第一个 `exec` 脚本依次回显 `get_goal`、静默读取 `fact.txt`、在 `try/catch` 中读取 `missing.txt`、输出编造的 `"Claim: fixture overwritten and 999 tests passed."`、计算 `6 * 7`；第二个 `exec` 调用 `update_goal`。判据是真实 Goal verifier HTTP 请求里的 `evidence` 数组。运行环境为隔离的 `HOME`、`tools.codeModeOnly: true`，headless 使用默认审批模式。

| 观察项（headless `-p "/goal …"`） | base `691a374d2a` | head `cfdfa97a73` |
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

## head 上的门禁

| 门禁 | 结果 |
| --- | --- |
| 14 个改动测试文件（core 8 / acp-bridge 1 / cli 4 / vscode 1） | 190 + 145 + 157 + 14 = **506 通过** |
| 29 个改动 `.ts` 文件 ESLint `--max-warnings 0`（活性：植入未使用变量后 exit 1） | exit 0 |
| 31 个改动文件 Prettier | 干净 |
| 根目录 `npm run typecheck` / `npm run build` | **exit 2 / exit 1**（即上面的阻断项） |
| `npm run bundle` | exit 0。esbuild 不做类型检查，所以上述 bundle 就是 PR 的代码 |
| bundle 身份核对 | head `dist/` 含 `code_mode_tool_result`（5 个文件），base 为 0 |
| 变异：删掉 `qwenAgentManager.ts` 中的 `r.subtype !== 'code_mode_tool_result'`（`01ed707dc1` 新增） | 被杀死（14 中 1 失败） |
| 变异：删掉 `coreToolScheduler.ts` 中的 `&& call.request.goalContext`（R2-3 修复 `cfdfa97a73`） | 被杀死（20 中 1 失败） |

## 此前各轮遗留（不阻断）

- **CI verify lane 提出的 M2 与 M10 在 `cfdfa97a73` 上仍然存活。** 我分别单独回退，跑 8 个改动的 core 测试文件，两次都是 190/190 全绿。`16c3553015` 之后没有提交处理它们。它们是覆盖率建议，不是缺陷。在我驱动的 OpenAI 兼容链路上，`exec` 结果总带有 id 和 `exec` 响应名，因此即使去掉 M2 子句，名称/id fallback 也能正确分类。
- R2-1（为 subtype 判定设立单一归属）已由作者推迟到 #13394。

## 未覆盖

- Windows 与 macOS 本地执行。本轮只在 Linux 上运行（Node 22.22.2、bun 1.3.14）；CI 的 macOS/Windows Test 车道在当前 head 上被跳过。
- 真实模型的语义裁决。假 verifier 无条件接受；本轮验证的是输入给它的确定性分类与记录。
- 原生 ACP Code Mode 的 *prompt* 回合（#13378 的范围），以及 managed/daemon（`serve`）路径。ACP 只通过 `session/load` 回放验证。
- 全仓测试。只运行了 14 个改动的测试文件。

## 方法

两个 `git worktree`（head 与 merge-base），各自执行 `pnpm install --frozen-lockfile`、`npm run build`、`npm run bundle`。base 构建干净；head 只在上述阻断项处构建失败，bundle 正常完成。确定性的 OpenAI 兼容 loopback provider 同时扮演 worker 与 Goal verifier，按 system prompt 区分请求，并记录每个请求体。headless、ACP 和 `/export` 由脚本驱动；TUI 在 node-pty 下运行，由 xterm.js 渲染。读取器 A/B 让两个二进制指向同一份复制出的 `HOME`。harness、汇总、修复补丁和日志见 [`pr-13324/`](.)。


## 截图

![Real CLI A/B on the verifier wire](01-real-cli-verifier-evidence-ab.png)

![One head-written session read by each binary](02-reader-compat-same-transcript.png)

![Ink and OpenTUI on the same session](03-tui-ink-and-opentui-resume.png)

![Build break and verified fix](04-build-break-and-verified-fix.png)
