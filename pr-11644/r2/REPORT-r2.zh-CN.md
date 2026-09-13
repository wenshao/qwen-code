# PR #11644 验证报告 —— 第二轮（`b27c100ea7`）

[English](REPORT-r2.md) · [第一轮](../REPORT.zh-CN.md)

## 维护者复验（第二轮）—— `b27c100ea7`，Linux

第一轮（[评论](https://github.com/QwenLM/qwen-code/pull/11644#issuecomment-5649574918)）验证的是 `144bc25a31`。此后新增两个提交：
- `0351faef57`：合入 `main` 并解决与 #11342 的冲突。
- `b27c100ea7`：提交前失败时恢复斜杠命令输入。

**验证环境**
- **测试环境：** 与第一轮相同，真实 `qwen serve` + Chromium，三个受信任的 git 工作区。
- **merge base：** 现为 `b5567bb7a9`。
- **对照包：** 同一个 daemon 二进制分别加载三个 Web Shell 包：
  - **base：** merge base。
  - **PR：** 当前 head。
  - **撤回修复：** head 仅恢复 `b27c100ea7` 在 `App.tsx` 中改动的那一行条件。
- **校验：** 恢复源码后重建的 PR 包逐字节一致（`index.html` md5 相同）。

**结论：建议合并。**
- **第一轮对照：** 各项结果在合并后的 head 上全部复现。
- **第一轮发现：** 与 main 的冲突（F1）解决正确；O1 的措辞已在 PR 描述和中英设计文档中修正。
- **新修复：** 端到端有效，撤回后问题重现。
- **chiga0 的 review：** 在 `0351faef57` 上的四项 blocker 中，F1、F4 在当前 head 不成立，F2 已由 `b27c100ea7` 处理，F3 在界面层面不成立（见 §3）。
- **剩余：** 一处不阻塞合并的测试缺口（M2）。之前 bot 的 `CHANGES_REQUESTED` 仍会阻止合并按钮。

![第二轮请求数对照](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/r2/fig1-requests.png)

### 1. 在合并后的 head 上复验第一轮对照

| 场景 | base | PR |
| --- | --- | --- |
| 闲置 75 秒、三行展开：概览 facet 读取 | 45 | **0** |
| 闲置 75 秒：侧栏 Git 读取（`beta-lib` + `gamma-docs`） | 2 | **0** |
| `beta-lib` facet：详情关闭时（35 秒 + 含 `focus` 的 67 秒） | 25 | **0** |
| `beta-lib` facet：详情打开 33 秒 | 5 | 10（保持 30 秒周期） |
| 菜单关闭后 `beta-lib` 的 facet / Git（67 秒 + `focus`） | 20 / 2 | **0 / 0** |
| 对话后聊天区 Git：环境卡片关闭 / 打开（各 65 秒） | 5 / 5 | **0** / 4 |
| `GET /workspace/providers`：启动时 / 每次打开设置页 | 3 / 0 | 2 / 1 |
| 会话外 Skills 目录：启动时 / 第一次 `/` / 再次打开 | 5 / 0 / 0 | **0** / 2 / 0 |
| `GET /capabilities`，页面加载 + 95 秒 | 9 | 3 |
| 闲置页面 95 秒内全部请求 | 175 | 90 |

- **不变的部分：** 首次渲染的菜单项两侧一致；草稿聊天中"图片 + Skill 命令"两侧都保留图片。
- **多一次读取：** 在上述草稿聊天流程中，PR 多一次 `supported-commands` 读取，即设计中的提交前分类读取。

**SDK 能力预检，在同一 daemon 上执行**（merge base 的 SDK 打包 vs PR `dist`）：

| 步骤 | base：capabilities + 列表 | PR：capabilities + 列表 |
| --- | --- | --- |
| 连续 4 次带来源过滤的列表（冷启动） | 4 + 4 | **1** + 4 |
| 并发 4 次（已预热） | 4 + 4 | **0** + 4 |
| 显式 `capabilities()` 后再列一次 | 1，然后 1 + 1 | 1，然后 **0** + 1 |
| 新 client 并发 4 次 | 4 + 4 | **1** + 4 |
| 未知能力 | 实时读取 + `DaemonCapabilityMissingError` | 实时读取 + 同样报错 |
| 61 秒后再列一次 | — | 1 + 1（TTL 过期） |

### 2. `b27c100ea7`：已有会话中恢复斜杠命令输入

**步骤：**
1. 用一轮对话创建会话。
2. 刷新页面时让 `GET /session/:id/supported-commands` 固定返回 `500`，再打开该会话，使其命令快照未知。
3. 附加一张 PNG，插入 `/release-notes <marker>` 并回车。

| 包 | 结果 |
| --- | --- |
| base `b5567bb7a9` | 请求**照常发送但图片被丢弃**，且没有任何提示。模型请求以 `Base directory for this skill: …` 开头，不含 `[image: image/png]`；输入框被清空。 |
| 撤回修复 | 提示 `Prompt failed: GET /session/:id/supported-commands: injected supported-commands failure`。输入框**为空**，文字和图片都丢失。 |
| PR `b27c100ea7` | 同样的错误提示。输入框恢复为 `/release-notes <marker>`，**图片也一并恢复**。 |

![恢复对照](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/r2/fig6-s12-recovery.png)

- **base 的行为：** 只要命令快照未知，就会静默丢弃附件。PR 把它变成了可见、可恢复的失败。
- **变异探针 M3：** 撤回这一行条件后，`preserves an unadmitted slash prompt after failure (new input: false)` 失败；`new input: true` 的对照仍然通过；未改动的文件 933/933 通过。

### 3. chiga0 在 `0351faef57` 上的 review

| 条目 | `b27c100ea7` 上的结果 |
| --- | --- |
| **F1** Git 视觉截图丢失 | **不成立。** spec 现在先打开环境卡片，再点击其中的分支行。CI 的 `Web-shell Visuals` 中 `git-branch-picker.spec.ts` 通过。本地 1/1 通过并生成三张截图（[01](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/r2/visual-spec/01-branch-picker.png) · [02](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/r2/visual-spec/02-commit-dialog.png) · [03](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/r2/visual-spec/03-create-pr-form.png)），截图 01 中是真实打开的分支选择器。 |
| **F2** 附件丢失 / 提交失败 | **已由 `b27c100ea7` 处理**（见 §2）。分类读取失败时提交仍会失败，但现在可见且可恢复。 |
| **F3** 分支信息带到另一个工作区 | **界面层面不成立。** 步骤：在已连接的 `alpha-app` 会话中打开环境卡片，执行 `git checkout -b feature/s13`，卡片约 1 秒内显示 `feature/s13`；再从 `beta-lib` 的工作区菜单新建任务。两个包的分支标签在 30 ms 到 7.6 s 的 16 次采样中全部为 `main`，从未出现 `feature/s13`。说明：我无法把会话的 git 事件与 App 自身的 Git 读取分开，因此这是用户可见层面的检查，不能证明 Provider 内部的保留条件。 |
| **F4** 空斜杠菜单时按 Escape | 处理逻辑检查的是 `slashMenuRef.current?.items.length`。改回 `if (slashMenuRef.current)` 后，`empty menu retains prior Escape default behavior` 失败。我无法在一轮对话进行中端到端构造出空菜单：即使阻断所有目录读取，已连接会话的 `/skills` 仍列出 16 项。此项依据是 DOM 测试加变异探针。 |
| **R1-23** 恢复超时 | **有测试覆盖。** 改回修复前的 `generation === capabilitiesGeneration` 后，`keeps the latest successful restore budget when newer discovery returns 503` 失败。 |
| **R1-3** Live 轮询 | Linux daemon 没有 `/live/setup`，只能靠单测。**M2 存活**，见下方测试缺口说明。 |

**M2 测试缺口（不阻塞合并）：** 从 `statusPending` 中删除 `Boolean(refreshError) ||` 后，`useLiveVoiceSetup` 的 8 项测试仍全部通过。原因是 `failed read` 用例失败的是**第一次**读取，此时 `!status` 本身就会保持轮询。因此"状态已经稳定加载后，某次刷新失败"这条路径没有测试覆盖。补一个针对该场景的测试即可。

### 4. 与 #11342 的合并冲突解决

`0351faef57` 在 `handleCloseAuthDialog` 中同时保留了 main 的 `reloadModelConfigurations()` 和 PR 按设置页可见性刷新 providers 的逻辑。对当前 `main`（`d47fa0202d`）执行 `git merge-tree` 无冲突。

**运行时检查：** 设置页 → Model → advisor 角色（显示为 `Use main model` 的按钮），两个包都能打开 `Set Advisor Model` 对话框，内容完全一致：`1. Use main model · Modality text-only · Context Window (unknown) …`。整个流程中两侧的 `GET /workspace/providers` 都是 4 次。仅在设置页读取 providers 的门控没有让 #11342 的角色模型对话框拿不到数据。

![PR 上的 advisor 对话框](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/r2/s15-pr-advisor.png)

### 5. 构建、测试与 CI（Linux，Node 22.22.2）

- **导出大小检查：** `Document export renderer JS` 在 base 为 1,857,007 字节，在 PR 为 1,857,224 字节（+217），上限 1,930,000，检查通过。CI 在当前 head 上同样记录 1,857,224 字节。作者评论中的 1,930,080 字节在 Linux 和 CI 上都无法复现。
- **浏览器端 daemon SDK 包：** base 243,458 字节，PR 244,414 字节。base 已超过 221,184 字节的警告阈值，所以该警告并非本 PR 新增。
- **单测：** 改动涉及的 12 个 web-shell 测试文件 **2043 项通过**；`DaemonClient.test.ts` **442 项通过**。
- **Playwright：** `web-shell.workspace-overview.spec.ts` 4/4；`git-branch-picker.spec.ts` 1/1。
- **CI：** `b27c100ea7` 上全部为绿色：Test (ubuntu)、Lint & Static、web-shell E2E Smoke、Integration (no-AK)、Desktop Shell、Web-shell Visuals。

### 仍然存在（与第一轮相同）

- **R1-1：** 非当前工作区失去侧栏分支选择器。
- **#11604：** 保持打开，跟踪剩余的延迟连接重复读取。
- **未覆盖：** Live 配置的端到端验证、嵌入式宿主不含 `gitBranch` 的 `composerToolbarActions`、macOS/Windows。

验证脚本、日志与图：[`asserts/pr-11644/r2`](https://github.com/wenshao/qwen-code/tree/asserts/pr-11644/r2)。
