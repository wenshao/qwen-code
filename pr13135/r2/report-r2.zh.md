<details>
<summary>中文版</summary>

## 真实环境验证（第 2 轮）— PR #13135 @ `d7c5c5e50e`

**结论：**
- R4-1 的修复在真实栈上成立。
- [第 1 轮](https://github.com/QwenLM/qwen-code/pull/13135#issuecomment-5945097553)通过的场景，在两次合 main 后仍全部通过。
- F1（容器重启后，被受理的关闭会卡住 Session 和所在存储）没有变化；作者说明准入策略尚未决定，所以它仍是合并前唯一需要拍板的事项。

图见英文部分。

### 相对第 1 轮（`6c6e58441a`）的变化

- **合 main：** 合了两次 main（#13136、#13155、#13084、#13137）。close 迁移从 V28 依次改为 V30、V31，SQL 内容不变。
- **R4-1 修复：** binding 从未保存 handle、lease 或 attestation 时，`stopDrained` 会在永久锁下先建 INTENT 注册再退休，然后写 receipt。
- **合并冲突的解决：** 我用 `git show --remerge-diff` 读了手工解决的部分，三处都保留了两边的改动：
  - `acquireWriter`：保留租户锁，后接 PR 的 Session 行检查；
  - `completeOperation`：使用数据库时间，并保留 DELETE 退休；
  - prompt 路由：保留 closing 守卫，以及单独的 Hook 忙错误码。
- **锁顺序：** `acquireWriter` 和 DELETE 完成都按「租户 → Session 行 → journal head」加锁，CLOSE 不取租户锁；合并没有引入反向加锁。

base 臂：`49b6c90053`（`HEAD^2`，即 main，含 V30）。装置与第 1 轮相同：专用 colima VM 里的 Linux 容器、MySQL 8.4.7、打包的 Harness 和真实 worker。

### R4-1 的真实栈复现

**构造方法：** 在 Spring 运行时把 Broker 状态目录改为 `0750`，`validate` 会拒绝它，于是注册创建失败，留下一个已提交、处于 `RECOVERY_BLOCKED` 且 handle 为空的 binding。随后把目录改回 `0700`，再关闭该 Session。

**旧 head：** 关闭一直停在 `recovery_blocked / workspace_close_identity_unverified`（120 s 后仍未完成），Session 为 CLOSING，binding 为 DRAINING。同一存储上的新 Session 在 447 ms 内失败。也就是说 R4-1 是真实存在的，而且和 F1 一样会让整个存储不可用。

**新 head：**
- 关闭 1.1 s 完成：Session CLOSED，binding RELEASED 并带 receipt。
- 注册记录写为 `RETIRED`、pid 0，即没有启动过 worker。
- 同一存储上的新 Session 正常完成。
- **单测钉子：** 把 `createIntent` 改回 `false` 后，`RuntimeHarnessDrainTest` 23 个用例中 2 个报错（正是新增的两个空状态目录用例），与作者的变异结果一致。

这条新路径覆盖不到 F1，因为 F1 场景下的 binding 已经保存了 handle。

### 在新 head 上重跑第 1 轮矩阵

以下场景在新 head 上全部重新通过，具体计数见图：

- 两个入口的正常关闭。
- 403/404 拒绝。
- Turn 运行中或等待审批时返回 `turn_active`。
- 同一存储上相邻 Session 的 Turn 进行中时关闭。
- 延迟 warm：13/13 干净，其中 8 次关闭时 binding 仍是 `PROVISIONING`，没有泄漏 worker。
- worker 被 SIGKILL；关闭中途 SIGKILL Spring（重启后 55 s 变为 CLOSED，原 worker 已停）；SIGTERM 重启 Spring。

### 升级

- **main V30 的库和 main 构建的 worker → 本 head：** V31 正常应用；两个已有的绑定 Session 都能关闭，main 构建的 worker 被停掉。第一个关闭等了 65 s，即上一个 Harness 的 writer 租约到期。
- **跑过本 PR 早先构建的库**（第 1 轮的 head，close 迁移记录为 V28）：新 head 启动失败，报 `Migration checksum mismatch for migration version 28`。
  - 只影响部署过本 PR 构建的环境；作者也已把这类升级列为未执行。
  - 这样的库需要先重建或手工修复，建议在 PR 的迁移说明里写一句。

### F1 没有变化

- **容器重启后：** 关闭重启前创建的 Session 一直停在 `recovery_blocked`（121 s 内尝试 7 次，binding 为 DRAINING）；该存储上的新 Session 约 2 s 失败。
- **同存储对照：** 重启前的 Session 不关闭时，存储照常可用（4.0 s 完成）；关闭它之后，该存储就开始失败（451 ms）。
- **新节点（空状态目录）：** 关闭被正确阻塞；恢复原目录后 30 s 内自行完成。
- **作者的态度：** 作者[同意方案 1](https://github.com/QwenLM/qwen-code/pull/13135#issuecomment-5945443122)：在写入 operation、CLOSING 和 fence 之前，如果已知原资源无法验证就直接拒绝。但还没有推送实现。
- **合并参考：** 要么先落地这项准入拒绝，要么在文档中写明容器部署的限制，以及它对同一存储可用性的代价。

### 新 head 上的定向测试（`d7c5c5e50e`）

- Broker：102 个单测，外加 `JdbcRuntimeBrokerMySqlIT` 7/7。
- Managed Agent：51 个单测，外加 `WorkspaceSessionCloseMySqlIT` 5/5。两者 checkstyle 均通过。
- `hosted-harness-session` + `hosted-hook-session`：跑一次，241/241。
- 本 head 的 CI：Hosted process fault gates 任务中，`HostedPublicWorkspaceIT` 跑了 3 个用例，0 跳过。

**本轮未重跑：** VM 重启 + `trusted-local-reboot-recovery` 场景。`stopDrained` 的这条分支自第 1 轮以来没有改动。

**未覆盖：** Windows、物理断电、多个 Spring 实例。

本轮证据在[这里](TREE)的 `r2/` 目录下，第 1 轮的材料也在同一处。

</details>
