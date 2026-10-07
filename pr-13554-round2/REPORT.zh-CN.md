## 维护者验证第 2 轮（仅增量）：#13554 @ `2e892a9d`

**结论：与[第 1 轮](https://github.com/QwenLM/qwen-code/pull/13554#issuecomment-6029915960)相同，未发现正确性或数据丢失缺陷；第 1 轮提出的合入前提已满足：本 head 上运行该模块的两条 CI 车道均已通过。** 我建议补齐 PR 模板章节后合入（见最后一条）。第 1 轮的性能后续项（8.1）和测试缺口（8.2）仍未处理，同样不阻塞。

**本轮变化**：`2e892a9d` = `5e5af00` 加上合并 `main` `a764fb9698`（#13551），没有其他改动。
- 其树（`10e3f13a`）与我第 1 轮在本地验证的合并树**完全相同**。
- 由该 head 构建出的生产 classes 与第 1 轮端到端运行的 classes **逐字节一致**（435 个文件，md5）。

因此第 1 轮的结果全部适用。我仍在这个确切 head 上重跑了各项闸门和关键场景。

![round 2](07-round2.png)

**本 head 的 CI**（第 1 轮时两条都被取消）
- `Runtime Broker and Managed Agent MariaDB / Java 21` **成功**：`SessionResourceCollectionCollectorTest` 44/44，模块 1083/1083，MariaDB 集成测试 53/53，Checkstyle 0。
- `Hosted process fault gates / MySQL 8.4 / Java 21` **成功**：新测试套件 44/44（×2），模块 1083/1083（×2），`HostedWorkspaceToolTurnIT` 8/8，`O4MySqlGate` 48/48。

**在 `2e892a9d` 的全新检出上跑的本地闸门**（全新的 `mysql:8.4.6` / `mariadb:10.11.18` 容器）

| 闸门 | 结果 |
|---|---|
| CI MariaDB 车道命令 | 1083/1083（2 跳过），集成测试 53/53，Checkstyle 0 |
| MySQL 8.4.6 上的 `-Po4-mysql-gates` | 48/48 |
| 经 `dataSource()` 覆盖跑 PR 测试套件，MySQL 8.4.6 | 44/44 |
| 经 `dataSource()` 覆盖跑 PR 测试套件，MariaDB 10.11.18 | 44/44 |

**用本 head 的 classes 重跑生产应用**
- **E2E-1（单实例）**：与第 1 轮一致。每个账本都逐字节一致，分页代数为 2（s1）、3（s2）、1（s6）。收集前后读取都返回 `409 tool_output_session_retired`。恢复读取器在本 head 返回 `resource_collected`，在 merge-base 返回 `resource_layout_unsupported`。重试告警 0，对象存储调用 0。
- **E2E-3a（页内崩溃）**：在页 `UPDATE` 已改 19 行、处于 LOCK WAIT 时 `kill -9`。41 行全部仍为 `PUBLISHED`，摘要完好。59 秒后另一实例接管，最终恰好 41,944,064 字节。

**在本 head 复测第 1 轮的发现**（代码未变，仍未处理）
- **8.1（100 万退休会话下的账本扫描）**：EXPLAIN ANALYZE 6,702 ms。真实应用 3 次调用平均 6.655 秒，每次检查 2,000,000 行。第 1 轮为 6,658 ms / 6.617 秒。
- **8.2（100 万已完成账本下的 claim 扫描）**：有 `gc_next_at >= 0` 时 0.012 ms，去掉后 1,800 ms。第 1 轮为 0.013 / 1,779 ms。
- **8.3**：文档小问题未变。PR 描述仍缺 `## Risk & Scope` 和 `## Linked Issues`，所以 triage 模板闸门的 `CHANGES_REQUESTED` 仍在。triage 于 03:22 重新触发的沙箱验证在本评论发布时仍在运行，本报告未覆盖它。

因二进制完全相同而未重跑的场景：E2E-2（三实例）、E2E-3b、E2E-4（升级）以及变异测试。它们沿用第 1 轮的结果。

本轮证据（截图、摘要、harness、md5 清单）在本目录；第 1 轮证据在 `../pr-13554/`。
