## 真实栈验证：#13194 @ `2486d3dad7`（Linux 持久化栈）

**结论：可以合并。** 在真实的 Linux 持久化本地进程栈上（打包的 Hosted Harness、真实 worker 进程、MySQL 8.4），Reviewer Test Plan 中所有能通过 API 观察到的主张在两个入口上都成立，包括 PR 自述未验证的那段：真实文件轮次 → #13135 物理停止 worker → archive/unarchive → delete，且同一共享存储上的邻居 Session 不受影响。base `main` `b3dda468f2`（即本 PR 的合并基）对同样调用返回 409。另有一项不阻塞的滚动升级加固（F1），附 2 行候选修复，已在同一栈上验证。

### 环境
- **两臂：** 分别从 `main` `b3dda468f2` 与 PR head `2486d3dad7` 构建 server jar；Hosted Harness 为 head CLI bundle 的 `qwen serve --profile hosted-harness`。
- **Linux：** colima VM（内核 6.8 aarch64）、Temurin 21.0.12、Node 22.23.2。
  - Spring 以 `durable-local-process=true` 运行并配置 Workspace 挂载；
  - 确定性 OpenAI 兼容模型驱动真实的 `write_file → edit → read_file`；
  - Spring 与 Harness 之间有一个记录代理；
  - MySQL 8.4.7 在宿主机上。
- **唯一非生产部件：** 一个 40 行过滤器，把 `X-Rig-Actor` 头映射为 `AuthenticatedTenantActor`，代替受信认证适配器。
- **L1+L2 全程监视：**
  - Spring→Harness 代理日志、模型请求日志；
  - 该 Session 的 binding、runtime session、lease、drain 行；
  - Broker 注册文件与 worker PID；
  - MySQL general log：任何涉及该 Session 或其 binding 的 runtime/lease/drain 表写入。

### PR head 结果
| 方面 | 结果 |
| --- | --- |
| 生命周期：Public（从 ARCHIVED 删除）/ WebShell（从 CLOSED 删除） | 39/39 与 40/40。<br>**archive：** 202，操作已是 `completed`。<br>**unarchive：** 200 CLOSED，`X-Qwen-Idempotent-Replay: false`；两个入口重放都返回 `true`，不新增事件，只有一行命令记录；重新归档后重放旧 unarchive key 返回 ARCHIVED，不发生变更。<br>**delete：** 202，175 ms（public）/ 171 ms（WebShell）内完成；之后两个入口的 Session 与 events 都是 404；操作仍可读（reader 200、无读权限 404）；同 key 重放返回原操作；旧 unarchive key 返回 404。 |
| 永久关闭围栏 | archive 后与 unarchive 后，Runtime `runtimes:warm` 均返回 409 `workspace_unavailable`（阳性对照：ACTIVE 邻居返回 200）；关闭回执与 drain 围栏行不变。 |
| 无 Runtime/Harness 工作 | L1+L2 全程：0 次代理请求、0 次模型调用、0 条该 Session 的 runtime 表写入；注册文件与 worker PID 不变。 |
| 邻居与共享存储 | 邻居始终是同一个 worker，删除后 warm 仍为 200；同存储上的新 Session 能跑文件轮次；被删 Session 的 Workspace 文件与 48 行历史资源保留（按文档，不做擦除）。 |
| 授权 | reader 403；无读权限或跨租户 404。<br>撤销创建者读权限后，重放、操作读取、unarchive、delete 全部 404；恢复读权限后重放恢复正常。<br>reader 复用创建者的 key：403。 |
| 状态与关闭证明 | 以下情形全部返回 409，且不持久化任何东西：<br>- ACTIVE；<br>- CLOSING（代理把 Harness 关闭压住 8 s）；<br>- DELETING（完成阶段被行锁压住）；<br>- 手工写成 CLOSED/ARCHIVED、没有关闭回执且 worker 仍存活。<br>非法 key 返回 400；大小写不同的 key 是不同命令。 |
| 并发（三轮：16、32、32 路并行，两个入口混合） | 24/24。<br>- 不同 key 的 unarchive/archive/delete：恰好一个成功；<br>- 同 key unarchive：全部 200、一个非重放、一行命令；<br>- 同 key delete：只有一个操作；<br>- archive 与 delete 互抢：终态一致。 |
| 删除中途崩溃 | 用行锁压住完成阶段后 `kill -9` Spring：什么都没提交（仍是 DELETING，无 retirement、tombstone、事件）。<br>停掉 Harness、设 `durable-local-process=false`、撤掉该存储挂载后重启：60.4 s 后（租约到期）以 claim generation 2 接管，retirement 与事件各恰好一次。同一实例上，对其他已关闭 Session 的 archive/unarchive/delete 约 200 ms 完成。 |
| 升级 | main 二进制下关闭的 Session 无需迁移（V32），换成 PR jar 后可 archive/unarchive/delete；main 下仍 ACTIVE 的 Session 由 PR jar 关闭（旧 worker 停止）后可删除。 |
| 读取 | **ARCHIVED：** Session、events（含轮次结果）、items、turns、WebShell get/transcript 和两个列表都可读。<br>**DELETED：** 全部 404，并且不出现在两个列表中。 |

**main 上（Before）：** 两个入口的 archive/delete 都是 409 `workspace_unavailable`；public unarchive 409；WebShell `/sessions/unarchive` 404；capabilities 中没有 archive/unarchive/delete 字段。

### F1（不阻塞，滚动升级）：旧版本协调器可能让绑定 DELETE 永久卡住
设计文档要求在受理 L2 前，所有 lifecycle worker 都已部署兼容二进制，理由是旧协调器"会尝试 Runtime 清理"。我实测了两种结果。两种情况的做法相同：PR 实例受理 CLOSED Session 的 DELETE，在完成阶段中途被杀，由 `main` jar 实例接手。

- **有 Runtime 关闭能力的 `main` jar：** 重做一次 drain（`qwen_runtime_harness_drain` 上一条幂等的 `INSERT … ON DUPLICATE KEY UPDATE`）后完成删除。无害。
- **没有 Runtime 关闭能力的 `main` jar（`durable-local-process=false`）：**
  - `settle()` 抛出 `workspace_close_identity_unverified`，操作变为 `RECOVERY_BLOCKED/BLOCKED`，Session 停在 `DELETING`。
  - 所有实例都换成 PR jar 后，180 s 仍未恢复：`findDeliverableOperations`/`claimOperation` 只重投 `CLOSE` 类型的 `BLOCKED` 操作。
  - 新的 delete/archive/unarchive 都返回 409，close 返回 409 `session_operation_active`，没有任何 API 能解开。

候选修复：`ManagedAgentStore` 中两个查询做同样的 2 行修改：
```diff
- (delivery_state = 'BLOCKED' AND operation_kind = 'CLOSE')
+ (delivery_state = 'BLOCKED' AND (operation_kind = 'CLOSE'
+     OR (operation_kind = 'DELETE' AND session_status_before IN ('CLOSED', 'ARCHIVED'))))
```
加上后，同一条卡住的记录在第一次扫描就完成：claim generation 3，retirement 与 tombstone 各一次。对这类记录，PR 自己的 `settle()` 在任何 Runtime 调用前就返回，所以这个修复只是让新二进制收尾旧二进制搁置的工作。候选版本单测 447/447；完整 IT 运行中，一个 `ManagedAgentMySqlIT` hook 用例在主机负载 ~70 时报错，单独重跑 2/2 通过。

若按文档协调发布，这一项不阻塞合并。但它静默发生、升级也无法自愈，建议采纳修复，至少写进发布说明。

### 本机测试（macOS、JDK 21、MySQL 8.4.7）
- `managed-agent-server` 单测 447/447，与作者结果一致。
- 真实 MySQL IT：
  - `WorkspaceSessionRetentionMySqlIT` 14/14；
  - `WorkspaceSessionCloseMySqlIT` 5/5；
  - `ManagedAgentMySqlIT` 19/19；
  - `WorkspaceRecoveryMySqlIT` 3/3；
  - `ToolPublicationRecoveryMySqlIT` 在 `TZ=UTC` 下 8/8。JVM 用 Asia/Shanghai、MySQL 用 UTC 时，main 与 head 都是 7/8 失败，属于与本 PR 无关的环境敏感问题。
- 新测试的变异检查：15 个单点变异体杀死 13 个。每个变异体都跑聚焦单测加 retention/close 两个 MySQL IT。
  - M1 去掉 `FOR UPDATE` 读租约，只有真实数据库的锁等待 IT 能杀死；CI 的 SDK Java MariaDB 通道已在本 head 上跑过该 IT（14/14）。
  - 两个存活体都不构成实际缺口：M11 把 actor 从 unarchive key 中去掉，但只有唯一记录的创建者能通过 `requireWorkspaceCreator`，因此观察不到差异；M13 去掉的完成阶段守卫已被准入阶段挡住，不可达。

### 未覆盖 / 说明
- **未覆盖：** Windows；Shell/MCP profile；真实 OSS 发布回收（files profile 不产生 Shell 发布）；物理擦除；L3/L4。
- **输入被拒不能作围栏证据：** main 上所有绑定 Session 的后续输入都会被拒（`submitTurn` → `requireLegacyWorkspace`），所以"archive 后输入被拒"不能证明关闭围栏；能证明的是带阳性对照的 warm 拒绝。

证据（探针、装置脚本、各场景 JSON/日志、变异矩阵）：[`wenshao/qwen-code@__SHORT__`](https://github.com/wenshao/qwen-code/tree/__SHA__/pr13194)。
