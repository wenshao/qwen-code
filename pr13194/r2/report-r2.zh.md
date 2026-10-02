## 第二轮：#13194 @ `a1c205021f`，F1 已修复，在同一 Linux 栈上复验

**结论：可以合并，我这边没有未决问题。** `a1c205021f` 修复了[第一轮](https://github.com/QwenLM/qwen-code/pull/13194#issuecomment-5955445033)的 F1，修法就是当时的候选补丁：编译后 `ManagedAgentStore.class` 中两条 SQL 谓词的常量池字符串与候选 jar 完全一致。我在同一 Linux 持久化栈上（打包 Hosted Harness、持久化本地进程 Broker、MySQL 8.4.7），每个场景用全新数据库，重跑了 F1 场景和第一轮的探针。

### F1 复验（两种来源状态）
两种来源状态的做法相同：
1. 修复后的 head 受理 CLOSED 或 ARCHIVED Session 的 DELETE；
2. 在完成阶段中途 `kill -9`；
3. 由没有 Runtime 关闭能力的 `main` jar（`durable-local-process=false`）接手，它照旧把操作搁置为 `RECOVERY_BLOCKED / BLOCKED`，claim generation 2，Session 停在 `DELETING`。

之后只运行修复后的 head：
- **两条 DELETE 都在第一次扫描完成：**
  - CLOSED 来源在 Spring 打出 `Started` 后 0.20 s 完成，ARCHIVED 来源 0.16 s；
  - claim generation 3；
  - 各有一行 retirement 和一个 `session.deleted` 事件；
  - Session 变为 `DELETED`，新的 API 调用返回 404。
- **没有 Runtime 调用：** MySQL general log 在修复 head 启动前就已打开，记录到每个操作的 `INSERT INTO qwen_output_session_retirement` 与完成 `UPDATE`，两个 Session 及其 binding 在 runtime/lease/drain 表上 0 写入。
- **修复前：** 第一轮（`2486d3dad7`）同一场景 180 s 后仍是 `BLOCKED`。

### 修复后 head 的回归（第一轮探针，未改动）
| 探针 | 结果 |
| --- | --- |
| 生命周期：Public（从 ARCHIVED 删除）/ WebShell（从 CLOSED 删除） | 39/39 · 40/40 |
| 授权、状态与关闭证明边界 | 16/16 |
| 并发，16 与 32 路 | 8/8 · 8/8 |
| L1/L2 期间的读取 | 4/4 |
| 删除完成阶段 `kill -9`，停 Harness、关闭能力与挂载后重启 | 7/7：kill 后 59.8 s（租约到期）接管，claim generation 2，恰好一次 |

### 测试
- **测试套件：** `managed-agent-server` 单测 450/450。真实 MySQL IT（`TZ=UTC`）：
  - `WorkspaceSessionRetentionMySqlIT` 16/16；
  - `WorkspaceSessionCloseMySqlIT` 5/5；
  - `ManagedAgentMySqlIT` 19/19；
  - `WorkspaceRecoveryMySqlIT` 3/3；
  - `ToolPublicationRecoveryMySqlIT` 8/8。
- **新谓词的变异检查：** 6 个变异体全部被杀死，包括：
  - 扫描或领取去掉 DELETE 分支；
  - 扫描或领取放宽到 ACTIVE；
  - 扫描或领取忽略退避。

  杀死它们的测试是 `recoversDeletionBlockedByAnOlderCoordinatorWithoutRuntime`（单测与 MySQL IT）和 `blockedActiveDeletionRemainsUnavailable`。
- **`a1c205021f` 上的 CI：** __CI_ZH__

更新后的设计文档把第一轮 Linux 证据归属到 `2486d3dad` 并写明了限制，描述准确。

**未覆盖：**
- 旧协调器与修复后的 head 同时连同一数据库运行的情形（我是先后运行的）。
- 与第一轮相同：Windows、Shell/MCP profile、真实 OSS 回收、物理擦除、L3/L4。

证据：[`wenshao/qwen-code@__SHORT__/pr13194/r2`](https://github.com/wenshao/qwen-code/tree/__SHA__/pr13194/r2)。
