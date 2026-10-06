## 维护者验证 — PR #13468 @ `0507359`

**结论：可以合入。** 我在真实 `qwen serve` daemon、真实 ACP 子进程上端到端跑通了修复，并用 Chromium 驱动了真实 Web Shell。base 构建能复现问题，未发现回归。下面有三条不阻塞的说明：第 2 条是 `main` 上已有的行为，第 3 条证实了一条仍待处理的 bot 建议。

### 测试方法

- **平台与构建**：Linux x86_64，Node 22.22.2。对 PR head `0507359` 执行真实的 `pnpm install --frozen-lockfile`、`npm run build`、`npm run bundle`。
- **同一棵树产出两个 bundle 臂：**
  - **base**：PR head，但把 `packages/cli/src/serve/routes/session.ts` 还原为 merge-base `85ea235` 的版本。这是 PR 唯一的生产代码改动。
  - **head**：推送上来的 PR head。
  - 在打包产物中 grep 确认了两者的差异：base 把 side-task 注册在 `withRestrictedMutableSession` 下，head 注册在 `withOwnerMutableSession` 下。
- **每个臂的环境：**
  - 一个 `qwen serve` daemon，注册三个工作区：主工作区、已信任的次要工作区、未信任工作区。
  - 隔离的 `HOME`、`QWEN_HOME` 和 runtime 目录。
  - 本地确定性 OpenAI 兼容模型：记录每一条请求，并能把回复挂起，让父会话保持忙碌。没有调用上游模型。
- **三种驱动方式：**
  - 原始 HTTP；
  - Playwright Chromium，访问 daemon 自带的 Web Shell；
  - 一个 `ssh://` 工作区，连到临时的本地 `sshd`（独立端口和密钥，未改动系统或 `~/.ssh` 配置）。

![修改前后：父会话忙碌时在次要工作区执行 /btw side](./fig1-ab-busy-parent.png)

### 真实 daemon A/B（HTTP）

| # | 场景 | base | head |
|---|---|---|---|
| 1 | 次要工作区父会话空闲时 `POST /session/:id/side-task` | 400 `non_primary_session_route_not_supported` | **201**：`workspaceCwd` 是次要工作区，`parentSessionId`/`sourceId` 是父会话，`sourceType: side_task` |
| 2 | 同上，但父会话这一轮被模型挂起 | 400 | **201**：父会话这一轮仍未结束时，子会话的提示词已经 `turn_complete` |
| 3 | 子会话是否继承父上下文 | — | 是。子会话的模型请求带上了父会话的 `ORCHID-7` 那一轮，回复也引用了它 |
| 4 | 父会话历史是否独立于子会话 | — | 是。父会话下一次模型请求不含子会话提示词；兄弟子会话也看不到第一个子会话的提示词 |
| 5 | 列表 `GET /workspace/<cwd>/sessions?sourceType=side_task&sourceId=<parent>` | 次要工作区为 0 | 次要工作区恰好列出 2 个子会话；同样条件查主工作区为 0 |
| 6 | transcript 落盘位置 | — | 父会话和两个子会话都只在次要工作区的 project 目录下 |
| 7 | 重启 daemon 后列表、`load`、发提示词 | — | 仍是同样 2 个 id。`load` 恢复的是同一子会话，且仍在次要工作区；提示词同时看到继承的历史和子会话自己的历史。没有重复（共 3 个会话），按主工作区过滤仍为 0 |
| 8 | 主工作区对照 | 201 | 201 |
| 9 | 未知所有者 id | 404 `session_not_found` | 404 `session_not_found` |
| 10 | standalone（无工作区）会话 | 400 `unsupported_action` | 400 `unsupported_action`（响应体相同） |
| 11 | 在次要工作区父会话上 `branch`、`fork` | 400 `non_primary_session_route_not_supported` | 不变 |
| 12 | 未信任工作区 | `POST /session` 返回 `untrusted_workspace`，所以根本没有父会话 | 相同。未信任所有者的侧任务拒绝由 PR 的五状态单测覆盖 |
| 13 | SSH 工作区（真实 `ssh://` 注册） | 400 `non_primary_session_route_not_supported` | 400 `unsupported_operation`，由 ACP 子进程守卫返回。没有生成子会话；连续 5 次失败也没有泄漏会话名额 |

### 真实 Web Shell（Chromium → daemon 自带的 Web Shell）

- **base**：在次要工作区会话里执行 `/btw side`，弹出 toast `Route "POST /session/:id/side-task" is only available for primary workspace sessions.`，面板显示“Failed to create side task”（图 1 上半）。
- **head**：侧任务面板在 `secondary` 中打开，并基于继承的上下文作答；此时父会话仍显示“Processing”（图 1 下半）。
- **head 完整重启 daemon 后**（图 2）：
  - 冷加载父会话后，右侧面板 › Side task 恰好列出 1 个子会话。
  - 重新打开该子会话，能看到之前的问答，在里面继续追问也正常。
  - 关闭再打开标签页，没有新发出任何侧任务创建请求（0 次）。

![daemon 重启后：持久化的次要工作区侧任务重新打开](./fig2-restore-after-daemon-restart.png)

### 测试

- **head 上：**
  - `multi-workspace-sessions.test.ts`：176/176
  - `server.test.ts`（整个文件）：1370/1370
  - Web Shell `App.test.tsx` + `SideTaskPanel.test.tsx`：1133/1133
  - acp-bridge 侧任务相关测试：7/7
- **负对照**：把 `session.ts` 还原到 merge-base 后，PR 新增的 daemon 用例中 4 个失败、172 个通过。说明新测试确实能区分修复前后。
- **与最新 `main` 合并**：与 `69d5db2` 无冲突。main 上较新的两个提交没有碰侧任务链路上的任何文件。
- **`0507359` 上的 CI**：25 成功、9 跳过、0 失败。写报告时 `review-pr` 还在运行。

### 说明（不阻塞）

1. **SSH 排除现在只在 ACP 子进程里执行。**
   - 本 PR 之前，路由包装器会拒绝所有非主工作区的所有者，SSH 工作区也在其中。
   - `withOwnerMutableSession` 只对 `cwdBound` 路由做 SSH 501 检查，而 side-task 不属于这类路由。所以请求现在会依次经过归档锁、代际守卫和 bridge 准入，最后才被子进程的 SSH deny-list 拦下（`acp-integration/ssh-workspace-guards.ts` 中的 `sessionSideTask`）。
   - 真实 SSH 工作区上实测：请求仍被拒绝，也没有落盘任何内容（图 3），所以设计文档里“SSH 排除仍然生效”的说法实际成立。
   - 但错误契约变了：从 `400 non_primary_session_route_not_supported` 变成 `400 unsupported_operation`，而不是其他被 SSH 拦截的 owner 路由所用的 `501 ssh_workspace_operation_unsupported`。daemon 层和 bridge 层都没有 SSH + 侧任务的测试。
   - 建议：在路由里提前拒绝 SSH 所有者，至少补一个测试把当前行为固定下来。
   - 另外，仅凭阅读代码（没有实际执行）：次要工作区里 Managed 引擎的父会话现在会拿到 bridge 返回的 `409 managed_session_branch_unsupported`，以前是路由返回的 400。
2. **`main` 上已有的行为：父会话忙碌时创建的侧任务，会继承父会话尚未回复的提示词。**
   - 子会话是从父会话的 recording 分叉出来的，而这份 recording 里已经有那条进行中的 user 消息。
   - 因此子会话的首个请求会把这条消息和侧问题作为同一条 `user` 消息的两个 text part 一起发出：`[{"text":"HOLD-PARENT: run the long parent task"},{"text":"What is the codeword while the parent is busy?"}]`。
   - base 在主工作区父会话上产生的结构完全相同。本 PR 只是让次要工作区也能走到这个既有行为。
   - 如果模型会调用工具，子会话可能会在同一工作区里开始执行父会话那条尚未完成的指令。值得专门做个决定或开后续 issue，但这不是本 PR 改出来的。
3. **我实际运行证实了 `0507359` 上那条仍待处理的 bot 建议**（第 2 轮，R1-1，由第 1 轮修复引入）。
   - 把 `sendStandaloneActionUnsupported` 两个调用点的两个 `string` 实参对调后，`server.test.ts › adopts a UUID legacy Conversations restore through the standalone service` 依然通过。
   - 没有任何测试固定 standalone 的响应体。
   - 这只是测试缺口。在 `genericActions` 循环里断言完整响应体即可补上。

![SSH 工作区：仍被拒绝，现改由 ACP 子进程守卫拦截](./fig3-ssh-workspace.png)

### 未覆盖

- Windows、macOS（只测了 Linux x86_64）。
- 真实模型服务（用的是确定性测试服务）。
- Managed 引擎和 internal 工作区的侧任务（只有单测和代码阅读）。

证据（harness、原始 JSON、逐步截图、单测日志）：本目录（`harness/`、`data/`、`screens/`）。
