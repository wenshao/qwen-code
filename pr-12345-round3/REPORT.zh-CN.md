# 第 3 轮验证（增量）：PR #12345 @ `51c74d01`，真实 daemon，Linux

**结论：仍可合并。** R6-1 的修复（`b2c9d90f`：命令快照已就绪但没有 `auth` 条目时 fail closed）在真实 `qwen serve` daemon 上按描述生效，还顺带堵住了 R6-1 没点名的主输入框两处泄漏。与 `main` 的合并（`51c74d01`）干净。没有新的阻塞项。

第 1 轮（[5791836687](https://github.com/QwenLM/qwen-code/pull/12345#issuecomment-5791836687)）和第 2 轮（[5797332888](https://github.com/QwenLM/qwen-code/pull/12345#issuecomment-5797332888)，head `abaf6e85`）的内容不再重复。本轮只覆盖 `abaf6e85..51c74d01`，外加第 2 轮列为"未覆盖"的一项：分屏和侧任务输入框在真实 daemon 上的行为。

## 1. 合并审计（`51c74d01`）

对比 `git diff <merge-base> b2c9d90f` 与 `git diff 64ac2faa 51c74d01`，即同步前后的 PR 补丁（3,923 行和 3,925 行）。去掉 `index`/`@@` 行后，差异只出现在 `client/index.tsx` 和 `App.tsx` 的一处 import 上下文。`index.tsx` 同时保留了 PR 的 `WebShellModelManagementOptions` 导出和 main 的消息导航导出，各一次。PR 的每一行 `+`/`-` 都保留下来；只有 `index.tsx` 里 PR 原本新增的空行变成了上下文行，因为 main 已经带了这一空行。

## 2. R6-1 的真实 daemon A/B

**环境。** 一个从 `51c74d01` 打包的真实 daemon，加一个记录请求的假 OpenAI 端点。同一个 daemon 前挂两个 vite dev server：**修复前** = `abaf6e85`（第 2 轮 head），**修复后** = `51c74d01`。daemon 配置了 `slashCommands.disabled: ["auth"]`，正好构成 R6-1 描述的"快照已就绪但没有 auth"状态。工作区放了一个项目命令 `.qwen/commands/login.toml`，用来遮蔽 `login` 别名。宿主传入 `modelManagement={allowAdd:false}`。分屏用 `?split=a,b` 打开两个真实会话，侧任务通过 `/btw side …` 创建。表中计数的是浏览器发出的 `POST /session/:id/prompt`。每一行都跑了两遍（第二遍在重启后的 daemon 上），结果一致。

| 位置 / 输入（`allowAdd:false`） | 修复前 `abaf6e85` | 修复后 `51c74d01` |
|---|---|---|
| 分屏，输入 `/au` | 菜单列出 `/auth` | 不再列出 |
| 分屏，提交 `/auth` | **发出 POST `/auth`**，无提示 | toast 拒绝，0 次 POST |
| 分屏，提交 `/connect` | **发出 POST** | 拒绝，0 次 POST |
| 侧任务面板，提交 `/auth` | **发出 POST**，无提示 | toast 拒绝，0 次 POST |
| 主输入框，提交 `/connect` | **发出 POST** | 拒绝，0 次 POST |
| 主输入框，`/btw side /auth` | **创建侧任务，并把 `/auth` 发了进去** | 拒绝，不创建侧任务 |
| 主输入框，菜单 `/au`，提交 `/auth` | 隐藏，拒绝 | 隐藏，拒绝（不变） |
| **对照：** 项目 `login` 遮蔽，在分屏和侧任务里提交 `/login x` | 正常运行（假模型收到 `PROJECT-LOGIN-COMMAND ran with: x`） | **同样正常运行** |
| **对照：** `allowAdd:true`，分屏 `/auth` | 列出，发出 | 列出，发出（不变） |

![split pane menu](./r3-split-menu.png)
![split pane typed /auth](./r3-split-typed-auth.png)
![side-task pane typed /auth](./r3-side-task-auth.png)

- **修复前的影响范围与 R6-1 给出的边界一致。** 对泄漏出去的 `/auth`，daemon 自己回复 `The command "/auth" is disabled by the current configuration.`（见截图左半），假模型收到 0 次调用。所以修复前的问题是策略和 UX 不一致，不能借此配置 provider。
- **更正 R6-1 的前提。** R6-1 认为 App 已经 fail closed，只有面板会泄漏。这对 App 的菜单和裸 `/auth` 成立，后者会被 App 的本地弹框路由接住。但在 `abaf6e85` 上，主输入框同样会发出 `/connect` 和 `/btw side /auth`（表中第 5、6 行）。这两条也走同一个 `isModelSetupCommand`，所以共用谓词的修法一并修好了它们。不过单测没有钉住这两条 App 路径：能杀死变异体的只有 `modelManagement` 和 `ChatPane` 的测试（见 §3）。以后如果有人在 App 里改回逐调用点判断，这里不会变红。这是可选的加固，不是合并条件。

## 3. 单测与变异

- `modelManagement.test.ts`、`ChatPane.test.tsx`、`SideTaskPanel.test.tsx`：在 `51c74d01` 上 **219/219** 通过。
- 变异体 `if (!resolved) return false;`（撤掉新分支）：恰好 2 个新测试变红，其余 217 个保持绿色。已恢复，工作树干净。
- `51c74d01` 的 CI：13 个通过，8 个跳过，`review-pr` 仍在运行。

## 仍然开放（不变，不阻塞）

- 公开的 `WebShellModelManagementOptions` API 形态由维护者决定（R2-8）。
- 第 2 轮的 `/config` 范围说明（`allowAdd:false` 下仍能在输入框用 `/config model.baseUrl=…`）：bot 把它记进了 `deferred-findings.json`，没有修复。是加门控还是写进文档，仍由维护者决定。

## 未覆盖

- SSH 工作区白名单路径（R6-1 的第二个触发条件）。它给谓词的是同样形态的快照（有 builtin 条目、没有 `auth`），但本轮没有实际跑。
- Windows/macOS 没有跑；`web-shell.model-management.spec.ts` 没有在本地重跑，由 CI 覆盖。
- 环境说明（不是 PR 的问题）：前几轮跑满 daemon 的会话上限（`maxSessions`，默认 32）后，`POST /session` 返回 503，面板因此拿不到命令快照。这时"快照加载前"路径会拒绝所有裸 setup 名称，项目 `login` 遮蔽也不例外。这是第 1 轮就有、有文档说明的"快照加载前 fail closed"行为，本 PR 未改动。

证据（截图、harness 页面、Playwright 探针、假服务、配置、原始 JSON/文本结果）：本目录。
