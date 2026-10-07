## 维护者验证：#13554 @ `5e5af00`（真实 MySQL/MariaDB + 生产应用）

**结论：未发现正确性或数据丢失缺陷。分支合并最新 `main` 后可合入**（本 head 上运行该模块的两条 CI 车道均被取消，见 §7）。我在真实 MySQL 8.4.6 与 MariaDB 10.11.18 上用生产 Spring 应用验证了所有能触达的安全性质，全部成立：
- 逐字节记账
- 行级与会话级栅栏
- 两种崩溃点下的原子性
- 跨实例接管
- 结果面
- V47→V48 升级

有一项带实测数据的非阻塞后续项：60 秒一次的账本扫描随退休历史线性增长，100 万退休会话时每实例每次 6.6 秒（§8.1）。

本报告建立在作者的 H2 报告和 @qqqys 的批准之上；后者自述为静态审查。下文全部是实际执行的结果。

**环境**
- 主机：Linux x86_64（16 核），JDK 21.0.12，Maven 3.9.9。
- 数据库：Docker `mysql:8.4.6` 与 `mariadb:10.11.18`（与 CI 同镜像），tmpfs，关闭 binlog。
- "生产应用"：PR 的 `target/classes` 加运行时 classpath，经 `ManagedAgentServerApplication` 启动，开启 `session-store`、`tool-publication`、`gc-enabled`。
- 唯一替换：OSS 适配器 bean 换成任何调用都抛异常的桩，各轮均记录到 0 次调用。
- 变异测试在 aarch64 上运行（Orange Pi，`maven:3.9.11-eclipse-temurin-21`）。

### 1. 真实数据库上的测试闸门

| 闸门 | 结果 |
|---|---|
| PR 测试套件（`SessionResourceCollectionCollectorTest`：自有 26 + 继承 18 = 44），经仅用于验证、覆盖 `dataSource()` 的子类，跑在 MySQL 8.4.6 | **44/44**，44 个独立库，每库应用 48 个迁移 |
| 同上，MariaDB 10.11.18 | **44/44** |
| PR head，CI MariaDB 车道命令（`-Pmysql-integration clean verify checkstyle:check`） | 1083 个，1 个错误：`holdsRestorePagesInsideThePerPageByteBudget`。该错误早已存在，main 已由 #13551 修复 |
| PR head 合并 `main` `a764fb9698`，同命令 | **1083/1083**（2 跳过），MariaDB IT **53/53**，Checkstyle 0 |
| 合并树，MySQL 8.4.6 上 `-Po4-mysql-gates` | **48/48** |

![gates](01-gates.png)

### 2. 生产应用单实例（E2E-1）

数据通过 worker 真实的 HTTP 路径写入（`writers:acquire` → `tool-results:publish` → `writers:seal`）。删除走生产 `lockDeletion()` + `retire()` 事务。配置：grace 20 秒，`gc-enabled=true`。

- **s1**（71 行，40.06 MiB）因 32 MiB 字节预算分 2 页：第 62 行为 1 MiB，加入会超过 32 MiB。
- **s2**（251 行）分 3 页，分别为 100、100、51 行。
- **s3** 为空会话，以 0 字节完成。
- **s6** 属另一租户，独立完成。
- **s4** 为存活会话，未被触碰，8/8 摘要完好。
- **s5** 为 `recovery_protected`，字节保留，下次尝试在 86,399 秒后。

每个账本的 `collected_bytes` 都等于已收集行之和。已收集行的 `inline_bytes` 全为 NULL，`sha256` 与 `byte_length` 保留。账本在各会话退休后 27–31 秒创建（20 秒 grace 加 60 秒扫描节奏的相位），之后每 1 秒 tick 一页。

**结果面**
- 对已退休会话的 HTTP 读取，收集前后都返回 `409 tool_output_session_retired`。
- PR 版本的 `WorkspaceRecoveryReader.resource()` 对已收集行返回 **`resource_collected`**。
- merge-base 版本对同一行返回 `resource_layout_unsupported`，与文档描述的 pre-V48 命名一致。

![single instance](02-e2e-single.png)

### 3. 三实例、51 个会话（E2E-2）

三个生产实例共享一个 MySQL；写入 51 个会话，共 7,176 行、388 MiB，然后一次性全部退休。

- **51/51 个账本逐字节一致**：收集 407,092,224 字节，等于各行之和；没有行仍为 `PUBLISHED`，没有已收集行残留字节。
- 三个实例各完成 17 个会话。
- `ER_LOCK_DEADLOCK` 为 0，`ER_LOCK_WAIT_TIMEOUT` 为 0（performance_schema 计数器，前后对比）。
- 收集期间对同租户的实时写入（3 × 30 MiB）全部成功。
- 44–55 秒的平台期就是文档所述的每次扫描最多 32 个账本：其余 19 个会话等待下一次 60 秒扫描。

![three instances](05-multi-instance.png)

### 4. 崩溃点（E2E-3）

- **(a) 页事务未提交时 `kill -9`**：另一客户端对一个 41 行会话的第 20 行持有 `FOR UPDATE`，使实例 B 的页 `UPDATE` 改完 19 行后停住。我在此刻 kill 掉 B（`INNODB_TRX` 中 `trx_rows_modified=19`）。41 行全部仍为 `PUBLISHED`、摘要完好；账本为 gen 1、cursor 为空、0 字节。B 的 60 秒 claim 过期后，实例 A 接管，最终恰好收集 41,944,064 字节。
- **(b) 两页之间 `kill -9`**：实例 A 在第 1 页（32 行，32,506,880 字节）提交后被 kill。实例 C 以 gen 2 接管，最终恰好收集 41,944,064 字节，即 32,506,880 + 9,437,184，无重复计数。
- **(c) 真实的页失败**：(a) 的较早几轮里，行锁持有时间超过了 `innodb_lock_wait_timeout`。生产日志依次为 `CannotAcquireLockException` → `will retry`；账本进入 `collection_retry`，所有行完好。下一次尝试逐字节完成。

![crash points](03-crash.png)

### 5. 升级与混合集群（E2E-4）

1. merge-base broker 以 `gc-enabled=true`、grace 5 秒运行 70 秒：已退休会话的流式捕获始终是带字节的 `PUBLISHED`，这正是 #13534 要补的缺口。
2. PR broker 在同一库上启动：Flyway 在已有数据的 schema 上应用 V48，约 1 秒后升级前退休的 3 个会话被逐字节收集；存活会话未被触碰。
3. merge-base broker 回到 V48 schema 上重启：日志为 `Successfully validated 48 migrations`（Flyway 忽略未来版本），正常启动，仍接受流式捕获写入，对已收集会话返回 `tool_output_session_retired`。

![upgrade](04-upgrade.png)

### 6. 变异测试：杀死 21/30

对收集器和恢复读取器做了 30 个单点变异，每个都跑 PR 测试套件。9 个存活者分为五类：

- **M08、M27**：去掉 `claim()` 中锁内二次校验（他人持有的有效 claim、尚未到期）。只有两个实例在候选扫描与加锁之间竞态时才会触发；即便触发，`page()` 也会按 owner/generation 再次校验，代价是浪费工作而不是重复收集。
- **M13、M14、M15**：去掉 `page()` 中的 generation、claim 过期、cursor 栅栏。在"每进程一个 UUID + `runOnce` 为 `synchronized`"的前提下，它们与 owner 校验冗余。
- **M02**：去掉 `storage_kind = 'MYSQL_INLINE'`，属等价变异：`TOOL_PUBLICATION` 行总带 `object_key` 且为 `REFERENCED`。
- **M04**（内容上限放宽 1 字节）和 **M29**（每 tick 只取 1 个候选）：未测的边界，影响低。
- **M26**：去掉 claim 扫描的 `gc_next_at >= 0`，影响性能，见 §8.2。

### 7. 本 head 的 CI

运行 `managed-agent-server` 的两条车道均被**取消**，因此 CI 从未在 Linux 上执行新测试文件：
- MariaDB 车道触发了 15 分钟的作业超时。
- Hosted MySQL 车道的 Maven 在 00:35:32 因 #13551 修复的旧错误报 `BUILD FAILURE`，随后该步骤一直挂到 60 分钟作业超时。

合并树在本地两种数据库上全绿（§1），合并 `main` 后重跑即可。另外 `V48` 同时被另外 6 个打开的 PR 占用（#13163、#13219、#13260、#13325、#13354、#13544）。后合入者需要改号，设计文档已写明这一点。

### 8. 发现

**8.1【后续项，性能】账本扫描的代价与退休历史成正比（O(history)）。** 稳态下每个墓碑都已有完成的账本，但 `ensureLedgers()` 仍会遍历所有到期的 `retired_at` 索引项，并对每项做一次账本索引探查，最后返回 0 行。MySQL 8.4.6 上 EXPLAIN ANALYZE 的实测：

| 退休会话数 | 每次扫描耗时 |
|---|---|
| 1 万 | 38.7 ms |
| 10 万 | 442 ms |
| 100 万 | 6,658 ms |

真实应用在 100 万历史上，150 秒内发出 3 次扫描，平均每次 6.617 秒、检查 2,000,000 行，约占每实例 11% 的数据库单核时间。

这次扫描还运行在单线程的 `managedToolOutputScheduler` 上，`ToolPublicationCollector` 和保留观察器也共用该线程，所以在这个规模下它们每分钟也会被卡住约 6.6 秒。

设计文档的开放问题 3 已预见这一点。一个便宜、无需跨实例状态的做法：无论有何 blocker，每个到期墓碑都会得到账本，所以当某次扫描返回不足 32 行后，实例可以只扫 `retired_at > (上次 due − slack)`；重启时补一次全量扫描即可。我不认为这会阻塞合入：该功能默认关闭，10 万以下代价很小。

![scan cost](06-scan-cost.png)

**8.2【测试缺口，低】`gc_next_at >= 0` 起关键作用，但没有测试固定它。** 正是这个条件让每秒一次的 claim 扫描与未完成工作量成正比，与设计文档的说法一致。在 100 万已完成账本下，claim 扫描保留该条件时 0.013 ms，去掉后 1,779 ms，而 44 个测试照样全过（M26）。建议用测试或注释固定它，例如断言 SQL 形状或检查查询计划。

**8.3【文档小问题】**
- **README 和运维文档只提到 `gc-enabled`。** 该收集还需要 `tool-publication.enabled=true`，而它又依赖 OSS 配置和嵌入式 Runtime Broker。设计文档写了，这两处没写。只存储后台 Shell 输出、但不启用 tool publication 的部署无法收集这些字节。
- **收集后的字节变成 InnoDB 表空间内的可复用空间，并不归还磁盘。** E2E-1 收集约 44.6 MB 后，`DATA_FREE` 为 47 MiB，`.ibd` 文件仍为 60 MiB。建议运维文档补一句，例如回收文件空间需要 `OPTIMIZE TABLE` 或重建表。
- **"44 个新收集器测试"实为新增 26 个**，另 18 个继承自 `ToolPublicationRetentionStoreTest`。

**8.4【覆盖说明】** 没有任何 Spring 测试会启动 `ToolPublicationConfiguration`：没有测试设置 `tool-publication.enabled=true`。因此新 bean 及其在 `managedToolOutputScheduler` 上的 `@Scheduled` 装配只由本 rig 证明（tick 运行在 `managed-tool-output-1` 线程上）。

### 未验证

- 真实 OSS。
- 经 CLI worker 的完整 Hosted 后台 Shell 运行。我改为直接驱动 worker 使用的 HTTP 接口。
- 运维侧工作区恢复的 HTTP 路径。我改为在真实数据行上直接调用 `WorkspaceRecoveryReader.resource()`。
- macOS 与 Windows。本次运行在 Linux x86_64 上，变异测试在 aarch64 上。

harness、原始数据与日志在本目录（`harness/`、`data/`）。
