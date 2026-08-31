# PR #10066 维护者验证报告（中文）

## 维护者验证 —— 真实 `qwen serve` 守护进程端到端

在 `702c665c94d66e4cd2aff1853502e6b74d5e6c47` 上于 Linux / Node v22.22.2（PR 标注"未测试"的那一行）针对**真实运行的 `qwen serve`** 完成验证：真实 HTTP、真实 ACP 子进程、经 `POST /session/:id/attachments` 的真实上传、磁盘上的真实字节。测试台使用隔离的 `HOME`、两个注册工作区、一个 OpenAI 兼容的 mock 模型，以及一个降权到 uid 1500 运行的守护进程实例——这样 `chmod 000` 才是真正的 `EACCES`，而不会被 root 直接绕过。

**结论：建议合入。** 39 项端到端检查中 37 项通过。失败的 2 项恰好是审查机器人在第 9–10 轮延后的两条 Critical：两条都能复现，且都是 fails-closed、影响范围限于单个工作区、不具粘性，并且只有在存储根处于**权限/IO 故障**状态时才会触发（根目录"不存在"的情形处理正确）。默认路径没有任何变化：不设置环境变量时的布局与之前逐字节一致。

**测试套件**：`sessionAttachments.test.ts` 76 通过；`bridge.test.ts` 836 通过；CLI 侧 `session-attachments-root` + `process-env-guard` + `shared-env-keys` + `session-archive` 共 132 通过；对 PR 新增逻辑植入 9 个变异体，**9 个全部被杀死**；本地完整 `npm ci && npm run build` 干净通过。

**1 · 迁移路径**（截图 1）：环境变量未设置时字节落在 `~/.qwen/tmp/<projectHash>/attachments/session-<id>/`，配置根不会被创建；设置后新上传落在 `<root>/<projectHash>/attachments/session-<id>/` 且不触碰默认目录；切换前上传的附件仍能按原字节读回（fallback 读取）；切换后同名上传被分配 `legacy (1).txt`，而切换前的 `legacy.txt` 仍返回**原始**字节——"不遮蔽"保证在真实 HTTP 上传下成立，而非仅在单测中；两个工作区共用同一配置根时各自拥有独立的 `<projectHash>` 子树。

**2 · 两个根上的生命周期**（截图 2）：`DELETE /session/:id/attachments/:id` 对"仅在 fallback"和"仅在配置根"的副本都能删除，删除后该 id 返回 404；对**确实已持久化**的会话执行 `POST /sessions/delete`（返回 `removed:[…]` 而非 `notFound`）会清理两个根下的会话目录，且不残留 `.deleting` 墓碑；`POST /sessions/archive`（同样非空转，返回 `archived:[…]`）保留附件，与文档一致；`POST /session/:id/branch` 会把两个根的附件都复制到新会话的配置目录——切换前的附件能在分支后存活。

**3 · 配置面**（截图 3）：项目 `.env` 中写入 `QWEN_SERVE_SESSION_ATTACHMENTS_ROOT=<exfil>` 被忽略——上传仍落在默认根，exfil 目录始终未被创建（对照组：同一变量放在守护进程启动环境中确实会改变存储位置，见第 1 节）。`PROJECT_ENV_HARDCODED_EXCLUSIONS` 端到端成立，而不只在 `fast-path.test.ts` 中成立。`~/…` 按守护进程 home 展开，相对路径按守护进程 cwd 解析，字节都落在解析器所说的位置。

**4 · 降级根 —— 两条延后的 Critical 均复现**（截图 4）：

- **F1 —— 配置根不可读时，`remove()` 拒绝删除只存在于 fallback 的副本**（延后项 `R7-2`）。`DELETE` 返回 `500 EACCES: … stat '<configured>/session-<id>/legacy-only.txt'`，而健康 fallback 中的副本仍留在磁盘上。`sessionAttachments.ts:729-732` 在改动任一根之前先用 `hasAttachment()` 探测两个根，而 `hasAttachment` 会把任何非 `ENOENT` 的 stat 故障重新抛出——于是一个降级的**配置**根会挡住只存在于**可写** fallback 中副本的 unlink。`docs/users/qwen-serve.md:724` 承诺旧副本"在默认 fallback 目录保持可写时可删除"，而代码额外要求配置根必须可 stat。建议要么放宽文档措辞，要么让某一个根上的非 `ENOENT` 故障降级为"未知"并仍尝试另一个根的 unlink。
- **F2 —— 旧 fallback 根 stat 被拒时，所有新上传都被拒绝**（延后的 write-arm 项）。`putAttachment` 对每个候选文件名都会查询 `statSizeStrict(<fallback>/<candidate>)`（`sessionAttachments.ts:412-420`），而 `statSizeStrict` 会重新抛出非 `ENOENT` 错误——于是一个不可读的旧目录会让本可由健康配置根服务的上传返回 `500 EACCES`。占用检查本身是对的，错的只是它的失败方式。实测影响范围：**该工作区的所有会话**，兄弟工作区不受影响，且不具粘性——恢复该根后上传立刻恢复。可以考虑"把 stat 故障有界地视为已占用，超出次数后退回随机后缀"，这样既保住不遮蔽保证，又不至于让写入失败。

两个故障都需要**权限/IO** 错误。旧目录不存在、乃至整个旧根都不存在的情形处理正确（`ENOENT` → 名字空闲，上传 `201`），已在第 2 节的 phase 9 中验证。

**5 · 变异测试**（截图 5）：对 PR 自身逻辑做了 9 处单行回退，全部被 PR 自带的测试套件捕获。覆盖：fallback 根传入 `deleteSessionAttachments`、fallback 文件名占用检查、`copyFrom` 中的 `removingNames` 过滤（R7-1 的修复）、孤儿回收的附件清理、读路径的 `peekDirectory()` 而非强制 `directory()`、`delete()` 的 fallback 分支、`remove()` 的 fallback 分支、`<projectHash>` 隔离段、以及环境变量值的 `trim()`。无幸存者。

**6 · 单向迁移的边界**（截图 6）：补上了此前被列为"未审查"的缺口——移除环境变量、以及从配置根 A 轮换到配置根 B，都会让根 A 中的副本不可达，表现为干净的 `404`，既不崩溃也不会返回错误字节。文档的"单向迁移"条目只写了"移除环境变量"这一个方向；建议补一句 A→B 轮换，因为在两个卷之间搬迁才是运维更容易踩的那种错。

**观察项（非阻断）**：

- **新增的孤儿回收清理实际在哪些路径上运行。** `deleteDaemonSessionIfOrphan` 在 `routes/session.ts` 中有四个调用点，三个是错误回滚路径，第四个是客户端断连分支 `if (!res.writable)`。在 Node 22 上，对端 socket 被销毁后 `res.writable` 仍为 `true`——用 10 行 `http.createServer` 验证过，端到端也验证过：一个发送完整 `POST /session` 后立即销毁自身的裸 socket，会让会话继续存活、两个预置的附件目录都原封不动。该分支是本 PR 未触碰的 `main` 既有代码；提出来只是因为它收窄了新增清理逻辑的实际生效范围。
- **第 10 轮的 `D10-1`**（回收器的 `removal.kind !== 'error'` 判定会在"行已删除但后续步骤出错"时跳过清理）确实存在，但 `main` 上的 `deleteDaemonSessions` 带有完全相同的判定——本 PR 是在沿用既有行为而非引入不对称，因此属于同一条后续项。

**未验证**：Windows 与 macOS；符号链接形式的 `runtimeBaseDir`（前几轮审查提到的 `path.resolve` 跟随符号链接问题）；真实负载下删除与会话恢复之间的并发——只验证了单进程内的顺序行为。

完整日志、截图与中文报告见 fork 上的 [`assets-pr10066`](https://github.com/wenshao/qwen-code/tree/assets-pr10066) 分支。

