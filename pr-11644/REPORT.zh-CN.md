# PR #11644 验证报告

发布于 https://github.com/QwenLM/qwen-code/pull/11644 · [English](REPORT.md)

## 维护者验证 —— 真实 `qwen serve` + Chromium 中的 Web Shell，Linux

验证 head `144bc25a31`，对照其 merge base `00d86315c8`。

**验证环境**
- **构建与对照：** PR 代码树只做一次 `npm ci` 构建。两侧运行同一个 daemon 二进制，只替换 Web Shell bundle。
  - base bundle 回退了 PR 在 `packages/web-shell` 和 `packages/sdk-typescript` 下的改动。`vite build` 之前先重建 SDK dist，因为生产构建从 `dist` 解析 `@qwen-code/sdk`。
  - 恢复后重新构建的 PR bundle 与实际产物逐字节一致。
- **工作区：** 通过 `--workspace` ×3 绑定三个受信任的 git 工作区，每个都带一个项目 skill：
  - `alpha-app`：当前工作区，3 个修改、2 个 stash。
  - `beta-lib`：1 个修改。
  - `gamma-docs`：干净。
- **请求计数方式：** 用 Playwright `page.on('request')` 记录浏览器到 daemon 的每个请求。对话轮次由 mock 的 OpenAI 兼容模型提供。

**结论：改动按描述生效。解决与 `main` 的新冲突（F1）后建议合并。**
- 闲置时的概览与侧栏 Git 轮询降为零。
- 可见的消费者保持原有周期，关闭后停止。
- providers、Skills 目录和能力预检的读取按描述减少。
- 我走过的用户路径均未出现回归。
- 措辞需修正一处：真实页面上 providers 读取是 3 → 2，而不是 2 → 1（O1）。

![请求数对照](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/fig1-requests.png)

### 1. 侧栏仅在消费者打开时读取概览与 Git（#11603、#11605）

三个工作区均展开、页面闲置，取前 20 秒之后 75 秒的稳定期：
- 概览 facet 读取：base **45**（5 个 facet × 3 行 × 3 次轮询），PR **0**。
- `beta-lib` + `gamma-docs` 的侧栏 Git 读取：base 2，PR **0**。
- 整个 95 秒内：base 共 174 个请求，PR 95 个。

`beta-lib` 分阶段计数：

| `beta-lib` 各阶段 | base facet / Git | PR facet / Git |
| --- | --- | --- |
| 闲置 35 秒，从未悬停 | 10 / 1 | **0 / 0** |
| 详情浮层打开 33 秒 | 5 / 1 | 10 / 1（打开时一轮 + 一次 30 秒 tick，`git?wait=1`） |
| 离开后 67 秒，含一次 `focus` 事件 | 15 / 2 | **0 / 0** |
| 工作区菜单打开 62 秒 | 10 / 1 | 15 / 2（3 轮） |
| 菜单关闭后 67 秒，含 `focus` | 20 / 2 | **0 / 0** |

- **为什么用 `beta-lib`：** 侧栏 Git 在它上面计数，而不是当前工作区。空状态的输入框工具栏显示 `gitBranch`，会合理地每 30 秒轮询当前工作区的 `/git`，路径与侧栏读取无法区分。
- **首次渲染的菜单项：** 两侧一致，都包含 `New worktree task`。
- **悬停摘要：** 为纯文本，复用既有文案：`main   3 modified · 1 untracked · 2 stashed`。

![悬停详情对照](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/fig2-details.png)

### 2. 聊天区 Git 读取跟随可见的消费者

在一次真实对话之后测试，此时默认工具栏已不含 `gitBranch`。统计 65 秒内当前工作区的 Git 读取：

| 环境信息卡片 | base | PR |
| --- | --- | --- |
| 关闭 | 5 | **0** |
| 打开（`Toggle environment information`） | 5 | 4（恢复 30 秒轮询） |

![环境卡片关闭与打开](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/fig5-chat-git.png)

<sub>红色 toast 是 mock 模型 id 带来的测试环境噪声，两侧都会出现。</sub>

### 3. 启动时读取：providers、Skills 目录、能力预检

- **`GET /workspace/providers`：** 聊天启动 base 3 → PR 2。每次打开设置页 base 0 → PR 1。设置页关闭时两侧均为 0。剩余两次读取的来源见 O1。
- **会话外 Skills 目录**（`/config/skills` 与 `/runtime/skills`）：
  - 启动：base 5 → PR **0**。
  - 普通输入：0 → 0。
  - 第一次输入 `/`：base 0 → PR 2。
  - 第二次：0 → 0。
  - 两侧都提供 `/release-notes`，候选项完全一致。
- **`GET /capabilities`：** 页面加载加闲置 95 秒，base 9 → PR 3。
- **同一 daemon 上的 SDK 对照**（base SDK bundle 对比 PR `dist`）：

| 步骤 | base：capabilities + 列表 | PR：capabilities + 列表 |
| --- | --- | --- |
| 连续 4 次带来源过滤的列表（冷启动） | 4 + 4 | **1** + 4 |
| 并发 4 次（已预热） | 4 + 4 | **0** + 4 |
| 显式 `capabilities()` 后再列一次 | 1，然后 1 + 1 | 1，然后 **0** + 1 |
| 新 client 并发 4 次 | 4 + 4 | **1** + 4 |
| `requireCapability('definitely_not_a_feature')` | 实时读取，`DaemonCapabilityMissingError` | 实时读取，同样报错 |
| 61 秒后再列一次 | — | 1 + 1（TTL 过期） |

### 4. 新代码路径检查

- **带未解析 Skill 命令的附件：**
  - 步骤：在草稿聊天中附加一张 PNG，不浏览候选，直接插入 `/release-notes <marker>` 并回车。
  - 两侧发给模型的请求都以 `[image: image/png] Base directory for this skill: …/release-notes` 开头，图片保留。
  - 两侧都只有同样一次 `GET /session/:id/supported-commands`。新的异步分类在此没有带来可见的额外请求。
- **R1-7（worktree 入口延迟出现）：** 在这些小仓库上无法观察到，菜单首次渲染时已包含 `New worktree task`。
- **R1-54（摘要过期）：** 同样无法观察到。
  - 步骤：在 `beta-lib` 详情关闭时修改仓库，再重新悬停。
  - 浮层可见时的第一次采样（悬停后 824 ms，含 300 ms 延迟）已显示 `3 modified · 1 untracked`。
  - 这两项在 `git status` 需要数秒的大仓库上仍有可能出现。

### 5. 可见的能力变化：非当前工作区的侧栏分支选择器（R1-1）

- **base：** 每一行都有 Git 标签。点击 `beta-lib` 的标签，会为这个非当前工作区打开 `Update Project / Commit / Push / View Changes / New Branch… / Checkout Tag or Revision…`。
- **PR：** 这个入口已移除，悬停摘要为只读。
- 与 Risk & Scope 说明及 R1-1 的处置一致。单独指出，是因为多工作区用户会注意到这个变化。

![侧栏 Git 前后对照](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/fig4-sidebar-git.png)

### 测试与 CI（Linux，Node 22.22.2）

- **单测：** 改动涉及的 12 个 web-shell 测试文件 **2041 项通过**；`DaemonClient.test.ts` **440 项通过**。
- **Playwright** `web-shell.workspace-overview.spec.ts`：
  - head 上 **4/4 通过**。
  - 用 merge base 源码配 PR 的 spec：两个改写的测试失败（闲置 facet 读取 `Expected length: 0, Received length: 21`；`Expected 10, Received 15`），两个未改动的测试通过。
  - 说明新断言并非空转。
- **`144bc25a31` 上的 CI：** Test (ubuntu)、Lint & Static、web-shell E2E Smoke、Integration (no-AK)、Desktop Shell、Web-shell Visuals 均为绿色。

### 发现

**F1 —— 与当前 `main` 冲突，合并前必须解决。**
- GitHub 当前显示 `mergeable_state: dirty`。
- 对 `b4d61e3a0b` 执行 `git merge-tree`，冲突在 `App.tsx` 的 `handleCloseAuthDialog` 一处：#11342 在本 PR 改写的注释正上方新增了 `void reloadModelConfigurations()`。
- *解决方式：* 保留 main 的调用及其依赖数组，注释取任一版本即可。
- *语义层面：* #11342 新增的 `providersState` 消费者（advisor 与 image 角色模型对话框）只能从设置页的模型区打开，此时 `providersEnabled` 为 true，因此仅在设置页开启的门控不会让它们拿不到数据。
- *rebase 之后：* 建议重跑 `App.test.tsx`。（`autofix/takeover` 已开启，bot 可能会处理。）

**O1 —— #11604 只解决了一部分：页面的 providers 读取是 3 → 2，而不是 2 → 1。**
- *判定方式：* CDP `Network.requestWillBeSent` 的 initiator 调用栈。
- *base 三次：* 两次来自 `DaemonSessionProvider` 延迟连接中的 `Promise.allSettled([client.workspaceProviders(), …])`，一次来自 `useDaemonProviders`。
- *PR 两次：* PR 去掉了 `useDaemonProviders` 那次。剩下两次的调用栈完全相同，都是启动期间该延迟连接批次执行了两次。
- *影响：* 这不是本 PR 的缺陷。但描述中的“一次初始化读取”应改为“两次”，#11604 也应保持打开，以处理 provider 内部的这次重复。

### 未覆盖

- **Live 配置轮询：** Linux daemon 上 `/live/setup` 返回 404，也不列出 `experimental.liveVoice.enabled`，该 hook 在此处不受支持。仅由 `useLiveVoiceSetup.test.tsx` 覆盖（通过）。
- **嵌入式宿主：** 显式配置不含 `gitBranch` 的 `composerToolbarActions`。daemon 自带的 Web Shell 无法触达，只有单测覆盖。
- **仅单测覆盖：** 扩展变更后的延迟命令刷新，以及目录加载失败与重试界面。
- **平台：** macOS 与 Windows。

验证脚本、原始 JSON 与日志：[`asserts/pr-11644`](https://github.com/wenshao/qwen-code/tree/asserts/pr-11644)。
