## 第 9 轮：在 `39267a90` 上的真实栈复验（Linux aarch64），只看第 8 轮之后的增量

**验证的 head：** `39267a90f2a05b8940db7676fea1f2237678ae62`，即发布时的 PR 最新提交。[第 8 轮](https://github.com/QwenLM/qwen-code/pull/13163#issuecomment-6041063311)验证的是 `f2864f6a`。

**本轮覆盖**的是 `f2864f6a` 之后合入的全部内容：
- 5 个生产修复：`0227b250`、`a9f7fec1`、`234037eb`、`2740c230`、`00be8ed0`；
- 迁移从 V51 改号为 V52；
- 截至 `39267a90` 的纯测试提交；
- 把 G3（#13174）、L3（#13354）和 #13658 带进分支的几次 main 合并。

**对照臂。** 每个臂各用自己的 server fat jar 和自己打包的 Harness：
- **head**：`39267a90`；
- **main**：`d735e20f`，即合并基；
- **x9**：在 head 上只回退 `234037eb` 的判定。改动只有 `WorkspaceExecutionStore` 里的一行：`throw actionResponse ? unavailablePendingGrant() : unavailable();` 改成 `throw unavailable();`。

把 head 试合并到当前 main `10078ddc`，没有冲突。

### 结论：`39267a90` 上没有发现阻塞问题

- **R3-1 修复端到端有效。** 设想审批答复正处于重试退避期，这时 `can_create` 被撤销，或注册表进入 DRAINING：
  - head 让答复保持待定，也没有任何调用到达 Harness。运维恢复状态后，head 把答复**恰好送达一次**（+6.2 s），Turn 正常完成。如果创建者改为取消，答复以 `action_cancelled` 结束。
  - x9 在 +1.3 至 1.8 s 把答复置为终态失败，Turn 随后卡在一个已经批准过的审批上。
  - main 在授权已被撤销的情况下**仍把答复送达 Harness**。
  - 结构性变更（generation 递增）在 head 上仍然终态失败，这是预期行为。
- **G3/L3 合并没有让取消路径回归。**
  - 与第 8 轮一致：12 格取消矩阵、冷缓存取消、重注册准入、重放顺序、被拒的改名、丢失投递，以及 WebShell 能力位翻转。
  - 本轮新增：授权被撤销的创建者先取消，再删除或关闭会话。head 上整个流程完成（取消 202 → CANCELLED；delete/close 202；模型请求被中止）。main 上取消被拒，delete/close 整整 60 s 都回 `409 turn_active`。
- **迁移升级可用。** V52 在 main 已有数据的库上 58 ms 干净应用，升级后的服务通过冒烟测试。
- **变异测试。** PR 自带的测试杀死了第 8 轮之后各修复的 8 个 Harness 变异中的 7 个，以及 5 个 Java 变异中的全部 5 个。
  - 被杀死的变异包括作者为 `39267a90` 报告的三个负对照。[qqqys 的评审](https://github.com/QwenLM/qwen-code/pull/13163#pullrequestreview-5453920145)把它们记为“声称而未验证”，这里已复现。
  - 有一个变异存活，只是覆盖缺口（见 §5）。
- **复现了一个 main 上同样存在的既有缺口。** 调度副本重启后，挂起的审批答复在默认配置下永远送不到。这不是回归，而且 head 比 main 处理得更好（见 §2）。

### 1. 运维改变工作区状态时的审批答复（R3-1：`234037eb`、`00be8ed0`）

**探针**（`c23-approve-retry.mjs`）：
1. 后续 Turn 等待审批，创建者批准。
2. tap 对第一次 `POST …/actions/:id/resolve` 回 503，答复因此进入协调器的重试退避。
3. 运维变更在退避期间落地。
4. 探针观察 `ACTION_RESPONSE` 操作、tap、Action 行和工作区文件。
5. 最后，探针要么恢复状态，要么让创建者取消。

| 退避期间的变更 | main `d735e20f` | x9（回退判定） | head `39267a90` |
| --- | --- | --- | --- |
| 撤销 `can_create` → 恢复 | 撤权后仍在 +1.6 s **送达 Harness**。被批准的写入始终没落盘，恢复 90 s 后 Turn 仍是 RUNNING | +1.8 s 变为 `FAILED workspace_unavailable`。恢复后 Action 仍是 `requested`，Turn 无限期等待 | **待定**：4 次尝试都在到达 Harness 之前被拒。恢复后在 +6.2 s **送达一次**，Turn 以 COMPLETED 结束，写入落盘 |
| 撤销 → 创建者取消 | 已送达；取消得到 **409**，Turn 仍是 RUNNING | FAILED；取消 202 → CANCELLED | 待定；取消 202 → CANCELLED；答复以 `action_cancelled` 结束，之后不再重试 |
| 注册表 DRAINING → ACTIVE | DRAINING 期间仍送达 | FAILED；Turn 被搁浅 | 待定，之后送达一次（+6.2 s）；COMPLETED |
| generation 递增（结构性）→ 恢复 | 送达 | +1.8 s FAILED | +1.8 s FAILED：结构性判定保持终态，符合预期。创建者取消可以结束 Turn |

**补充运行：**
- 单调度器拓扑下，撤权 → 恢复 3 次全部送达（保持 12 s 和 30 s 两种）。
- 在第一种拓扑下（§6 的 rig 修正之前）：
  - unread（读和创建权限都被撤销）先保持待定，恢复后送达；
  - storage 迁移则终态失败。

### 2. 既有问题（main 上同样存在）：调度副本重启后，挂起的审批答复永远送不到

这是上图的下半部分，一次**完全不改工作区**的对照运行。Harness 对每次 resolve 都回 503。调度副本重启（附着缓存变冷），然后 Harness 恢复。

- **热缓存（不重启）：** main 和 head 都只送达一次，分别在 +6.8 s 和 +6.4 s。
- **重启之后：** 两个臂都卡住。每次重试的冷重附着 `POST /session/:id/load` 都得到 `409 hosted_session_already_attached`，80 s 内 13 到 15 次，此后每 60 s 重试一次。
- **原因。** `qwen.managed-agent.runtime-broker.verified-workspace-recovery-enabled` 默认是 `false`，所以 action-response 的冷路径做的是非被动 load：
  - head 上 `doResolveAction` 调用 `doCreateOrLoad(…, verifiedRecoveryEnabled(), true)`（`QwenHostedHarnessConnector.java:438`）；
  - main 上调用 `attachment(tenantId, sessionId, true)`。

  Harness 会拒绝对常驻会话的任何非被动 load（`hosted-harness-session.ts:2106`）。这与第 6 轮记录的“调度副本重启后非被动 load 被拒”属于同一类问题。
- **创建者的出路不同。**
  - head 上，取消借助本 PR 的冷取消路径，在 +43 s 进入 CANCELLED。
  - main 上，取消 60 s 后仍停在 CANCELLING。
- **对本 PR 的影响。** 默认配置下，`00be8ed0` 在冷路径上的判定分类无法被端到端触达，因为 Harness 先拒绝了重附着。
  - 它在单元层面已被固定：下文 J2，以及作者的真实 JDBC 测试。
  - 在撤权加重启的情况下，head 让答复跨重启保持可重试（而不是 FAILED）。恢复后它会遇到同样的 409。

建议另开问题单跟踪，这不阻塞本 PR。

### 3. main 合并之后的回归矩阵

- **取消矩阵（c1，12 格）。**
  - 在撤权、DRAINING、generation 递增、storage 迁移或无变更（晚恢复和早恢复）下，创建者取消都得到 202。Turn 在 +0.4 至 1.3 s 进入 CANCELLED，模型请求被中止。
  - 拒绝情形：读者 bob 和另一位创建者 carol 得到 409；陌生人 mallory，以及没有读权限的创建者，得到 404。拒绝时不写命令行。
  - Turn 结束约 2 s 后拒绝解除，下一个 Turn 正常完成。
  - main 在撤权和 DRAINING 两格：409，Turn 一直跑到 +30 s 才 FAILED，模型请求没有被中止。
- **冷附着缓存（c14：Turn 运行中重启调度副本，Session Store 在副本 B）。**
  - head：取消 202，然后 `load` 200，然后 `POST /cancel` 204。撤权时 Turn 在 +41.5 s 进入 CANCELLED，授权完好时为 +40.3 s。模型请求被中止。
  - main：撤权时 409 且一直 RUNNING；授权完好时 202 后停在 CANCELLING，伴随 `load 409`。
  - #13413 的写入器锁死没有出现（4 次冷重启 0 次）。
- **取消后删除或关闭（c24，新增）。**
  - head：取消 202，Turn 约 0.5 s 内进入 CANCELLED。delete/close 回 202；立即发送时，delete 先得到一次 `409 turn_active`。会话最终为 DELETED 或 CLOSED，模型请求被中止，没有任何写入。
  - main：取消得到 409，随后 delete/close 在 64 s 内收到 `409 turn_active` ×120。Turn 继续运行，在取消约 90 s 后自行失败；会话仍是 ACTIVE。
- **其他探针，全部通过：**
  - c5：12/12；
  - c7：1/1；
  - c8：6/6；
  - c3：6/6；
  - c16（WebShell 能力位翻转）：5/5；
  - f4b：CLOSED/ARCHIVED/DELETED 的拒绝行为不变；
  - c19 改名竞态：存活的重试胜出，数据库与 Harness 一致。
- **c21：** 已知的改名边界分歧仍会复现，与第 6 至 8 轮一致。数据库是“Alpha”，Harness 最后的标题是“Bravo”。已延后到 #13269。
- **升级。**
  - 起点是 main 的数据库：V51，由整个 main 臂写入了数据。
  - head jar 首次启动时用 58 ms 应用 V52 `managed mutation attempt sequence`；下一次启动校验了 52 个迁移。
  - 在 main 没用过的 storage 上做的冒烟全部通过：c1 撤权取消、c19 和 c21。

### 4. 真实浏览器中的 WebShell

ManagedAgentWebShell 由 vite 提供，用 Playwright Chromium 驱动，连接各臂真实的服务端。

- **head：** 授权被撤销的创建者能看到**“Cancel turn”**，点击后 Turn 在 +1.65 s 进入 Cancelled。zh 语言、DRAINING 状态下，**取消本轮**同样有效。
- **读者：** bob 点击后得到 409，并出现提示“Hosted Workspace execution is not available.”，Turn 继续运行。这对应 R1-6 的建议项：读者仍能看到这个按钮。
- **main：** 撤权后不显示取消控件。

### 5. 测试套件、变异与 CI 车道

- **测试套件：**
  - Harness `hosted-harness-session.test.ts`：**297/297**。
  - JDK 21 + H2 上的 Java 聚焦测试类：**145/145**。这些类是 `WorkspaceStorageGuardTest`、`QwenHostedHarnessConnectorTest`、`ManagedActionsTest`、`ManagedSessionLifecycleTest`、`QwenHostedHarnessColdCancelRegressionTest` 和 `ManagedWorkspaceAdmissionTest`。
- **变异**，逐个施加并按字节还原：
  - T1–T8 覆盖 `2740c230` 和 `0227b250`，包括 `39267a90` 的两个守卫：**8 个杀死 7 个**，每个都失败在线上状态码断言。例如 T2 失败为 `expected 200 to be 404`，T3 为 `expected 200 to be 409`。
  - J1–J5 覆盖 `234037eb`、`00be8ed0`、`a9f7fec1` 和 R3-4 的 `FAILED` 前置条件：**5 个全部杀死**。
  - J5 使 `pendingRenameCompletesAfterAnOlderRetiredSibling` 失败，这正是作者的 R3-4 对照。
- **存活的变异（T5，仅为建议级）。** 删除**取消结算**分支里 await 之后的 `resident.mcpClosing` 守卫（`hosted-harness-session.ts:2082-2085`，由 `0227b250` 引入），套件仍是 297/297。
  - 它的兄弟身份守卫（T4）有测试固定，`answerResidentInapplicable` 中的两个守卫（T2、T3）也有。
  - 在 *refuses a cancellation takeover attachment deleted during settlement* 旁边补一个 closing 变体就能固定它。
- **在本机重放 CI 数据库车道**，镜像和 Maven 调用与 `sdk-java.yml` 相同：
  - **MariaDB 车道：** BUILD SUCCESS。runtime-broker 跑了 751 个单测和 7 个 IT；managed-agent-server 跑了 1388 个单测和 125 个 IT；Checkstyle 和 failsafe 类检查均通过。
  - **Hosted MySQL 8.4 车道：** head 上三次完整运行中，`HostedPublicWorkspaceIT` 分别为 5/5、4/5、5/5。唯一的错误是 `durableCloseStopsOriginalWorkersAndRetainsHistoryAndFiles(crash=false)`：“Later Turn failed”。
    - 单独重跑 3 次全部通过（15/15 个测试），main 的两次运行也都是 5/5。我把它视为本机上的一次性偶发。
  - **本机伪影。** 本机的每次完整运行（head 三次、main 两次）还会在 `HostedWorkspaceConcurrencyIT` 的清理阶段报错：来自 `managed_agent_snapshot` 的外键，而它的清理列表漏了这张表。main 上完全相同，单独运行 3 次都通过，所以这来自本机的测试顺序。
  - **该 head 上的 GitHub CI：** 28 项构建与测试检查全部通过，包括 `Hosted process fault gates / MySQL 8.4 / Java 21`（`HostedPublicWorkspaceIT` 在这里运行）和 `Runtime Broker and Managed Agent MariaDB / Java 21`。其余条目只有一个被取消的 `route` 分派作业和一个排队中的 `delay-automatic-review`。

### 6. rig 说明：一个本 PR 之外的既有行为

**rig 的拓扑。** 本 rig 用第二个副本只提供 Session Store（`harness.enabled=false`），以免调度副本重启时触发 #13413 的锁死。

**这个副本的行为。** 它的 `ActionResponseCoordinator` 仍会扫描并认领 `ACTION_RESPONSE` 的重试。
- 每次都以 `UnsupportedOperationException: Hosted Actions are unavailable` 失败，这是默认的 `HarnessConnector.resolveAction`。
- 每次失败都会按退避推迟 `available_at`。

**对我最初几次运行的影响。** head 的可重试答复比 main 存活更久。最初 4 次热缓存恢复运行中有 2 次，恢复之后的每次认领都被这个副本抢到（被追踪的那次连续 6 次），投递因此停滞。

**修正。** 让该副本失效（`dispatch.scan-delay=3600s`），或只用单调度器，都能恢复预期的投递，6 次全部成功。上文所有数字都来自失效后的拓扑。

**影响范围。** 只有当部署让禁用 Harness 的副本和调度副本共用同一个数据库时，这才有影响。本 PR 对协调器的改动仅限于终态出口。

### 未覆盖

- **R2-3（瞬时挂载 I/O）的端到端验证。** 需要 root 进程读挂载时出现 I/O 错误；J4 覆盖了它。
- **`2740c230` 和 `0227b250` 在 Harness 内部的时间窗**（prompt slot、teardown）。只由单元测试和变异覆盖。
- **`verified-workspace-recovery-enabled=true` 配置**：此时 action-response 冷路径会做被动 load。
- **真实模型；head 上的 macOS 或 Windows；真实栈 rig 上的 MySQL 8.4 或 MariaDB。** 这两种数据库由 CI 和本机车道重放覆盖。

### 方法

- **真实栈 rig：** Orange Pi 6 Plus，Linux aarch64，Node 24.14.0，JDK 21.0.12，MySQL 8.0.45。
  - 每个臂各有自己的 server fat jar（内嵌 Runtime Broker，durable local process）和自己打包的 Harness（`dist/cli.js serve --profile hosted-harness`）。
  - 用脚本化的 OpenAI 兼容模型代替真实模型。
  - Spring 和 Harness 之间有一个录制 tap。
  - Session Store 运行在第二个副本上。
- **单元测试、变异和车道重放：** Linux x86_64，Node 22.22.2，JDK 21.0.10。
- **jar 核验：** head 和 x9 包含 V52，main 不包含。x9 的 `WorkspaceExecutionStore.class` 与 head 不同。

**证据：** [`wenshao/qwen-code@assets-pr13163/pr13163/r9-linux`](.)，包含探针、每次运行的 JSON 与日志、变异台账、车道摘要和 WebShell 截图。
