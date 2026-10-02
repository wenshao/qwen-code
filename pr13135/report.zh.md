<details>
<summary>中文版</summary>

## 真实环境验证 — PR #13135 @ `6c6e58441a`

**结论：在真实的 Linux durable 栈上，关闭路径按设计工作；有一项发现需要在合并前决定。**

- 正常关闭在 public 与 WebShell 两个入口都成立；拒绝、竞态、崩溃接管、重启和升级也都按设计工作（图 1）。
- **F1：** 容器重启后（同主机、同 boot，新的 PID/time 命名空间），关闭被受理却永远完成不了，即使原 worker 已确定不存在。在它卡住期间，同一 Workspace 存储上的新 Session 全部失败。
  - 本 PR 之前，同样的关闭会被拒绝，Workspace 照常可用。
  - 这是 bot 那条被婉拒的 [R2-2](https://github.com/QwenLM/qwen-code/pull/13135#discussion_r4161801652) 的具体、可复现形态。

Head `6c6e58441a7ead652db311e185e0f8e7836fd2ed`。base 臂是 `3f56f74a6a`，即 PR 的 merge-base（`HEAD^2`）；此后 `main` 只多了一个无关提交。

### 环境

- **Linux：** Spring fat jar 内嵌 durable local-process Broker（`durable-local-process=true`），跑在专用 colima VM 里的 Linux 容器中：arm64、内核 6.8、`eclipse-temurin:21-jre`、Node 22.23.2，`/etc/machine-id` 绑定挂载以保持稳定。
- **其他组件：** 打包产物 Hosted Harness（`dist/cli.js serve --profile hosted-harness`），以及真实的 `managed-runtime-worker` 进程。
- **数据库与模型：** MySQL 8.4.7 跑在宿主上；OpenAI 兼容模型用脚本驱动。
- **身份：** 认证适配器提供 `alice`（创建者）、`bob`（只读）、`mallory`（无权限）。
- **macOS：** 默认（非 durable）部署单独验证。
- **判据：** 每项检查都读数据库行、Broker 状态目录里的注册文件，以及容器内的 `/proc/<pid>`。

### 1 — 成立的部分

见图 1。要点：

**正常关闭。**
- `202` → 约 160–220 ms 内 `completed`，Session 变为 `CLOSED`。
- 原 worker 的确切 PID 退出，注册文件变为 `RETIRED`，binding 变为 `RELEASED` 并带 drain receipt。
- 历史保留：47 个资源，事件可读；Workspace 文件也保留。
- 在**另一个**入口用同一个关闭键重放，返回同一个 operation。
- 同一存储上的新 Session 能正常运行。

**延迟 warm。**
- 纯文本 Turn 后立即关闭时，18 次中有 **9 次**关闭时 binding 仍是 `PROVISIONING`。
- 关闭会等这个 worker 起来，然后把它停掉，没有 worker 泄漏。

**崩溃接管。**
- 用 tap 延迟 Harness 的 `DELETE`，在关闭进行 3 s 时对 Spring 发 SIGKILL。
- worker 成为孤儿进程，但仍存活。
- 重启后的 Spring 在租约到期后接管（47 s），停掉原 PID 并完成 operation；之后同键重放返回已完成的 operation。

**升级。**
- head jar 接管 base 构建的库（V27）和 base 构建的 worker，并应用了 V28。
- 两个既有的绑定 Session 随后都能关闭，base 构建拉起的 worker 也被停掉。

### 2 — F1：被受理的关闭会把 Session 和整个存储一起卡住

见图 2。

- **触发：** 对运行 Spring、Broker 和 worker 的容器执行 `docker restart`。主机和 boot id 不变，time 命名空间换新。
  - 所有 worker 随容器一起退出。
  - 关闭任何重启前创建的 Session，都先返回 `202`，然后一直停在 `recovery_blocked / workspace_close_identity_unverified`；binding 停在 `DRAINING`（150 s 内尝试 8 次）。
- **波及范围：** 同一存储上的新 Session 在约 1.3 s 内失败（`hosted_turn_failed`，Spring 日志为 `An earlier runtime placement still requires physical recovery`）。其他存储正常。
- **同一存储上的 A/B：** 同样的重启之后，**未关闭**的 Session 所在存储完全可用（新的文件 Turn 3.3 s 完成）；一旦关闭这个 Session，该存储就变成失败（465 ms）。
  - 也就是说，让 Workspace 不可用的正是本 PR 新开放的这个用户操作。
- **没有出口：**
  - 容器重启后，原命名空间无法恢复。
  - `WorkspaceRecoveryCommand inspect` 拒绝，报 "Exact Hosted Shell operator recovery is unavailable."；files/1 关闭没有可供它恢复的 holder。
  - 也没有取消关闭的 API。
- **能解开的办法：**
  - 一次真实的 VM 重启，再用 `trusted-local-reboot-recovery=true` 重启 Spring。之后 5 个卡住的关闭全部完成，receipt 记录的是原 boot。
  - 不开这个开关时，重启后仍然阻塞，符合设计。
- **对照「新节点」：** 换一个空的状态目录（即「新节点」情形）时，关闭被阻塞是正确的，因为原 worker 确实还活着；恢复原目录后，约 33 s 自行完成。

失败关闭规则本身没有问题：它无法区分容器重启和新节点这两种情形。需要维护者决定的是，受理关闭应该付出什么代价。

可选方案，按成本从低到高：
1. 受理时，如果保存的注册记录已经无法从当前 boot 和命名空间验证，就直接拒绝（409，不写 fence）。可以复用 `verifyOperatorRegistration` 那样的只读检查；这样 Workspace 保持与本 PR 之前一样可用。
2. 给 files/1 关闭提供运维证明停机的路径，类似 Shell 的恢复命令。
3. 如果前两项都不在本 PR 范围内，就在文档中写明：durable local-process 要求 PID 和 time 命名空间在 Spring 重启后保持不变（VM 或宿主 PID 命名空间，而不是可重启的容器），并建议开启可信重启恢复。

一个相关观察：容器重启后，内核复用了 PID 命名空间的 inode 号（前后都是 `pid:[4026532380]`），只有 time 命名空间不同。
- 不创建 time 命名空间的运行时（例如 containerd/Kubernetes 默认）因此可能让这个情形时过时不过，取决于 inode 是否被复用。
- PID 启动 tick 校验仍能防止向错误的进程发信号。

### 其他观察（非阻塞）

- **既有问题：** 首个 Turn 挂住的绑定 Session 无法取消，因为在这个 base 上 `agent.session.cancel` 返回 `409 workspace_unavailable`；所以也无法关闭（`409 turn_active`）。
  - Harness 每 120 s 重试一次模型请求（在我让模型应答之前观察到 4 次）；这个 Turn 一直 RUNNING 了约 7 分钟。
  - 关闭正确地拒绝了；这只说明关闭不能作为卡住的绑定 Turn 的逃生口。
- **错误码：** 向 CLOSED 的绑定 Session 发新输入，返回 `409 workspace_unavailable`，而不是生命周期类的错误码；用新的关闭键则返回 `409 session_state_conflict`。
- **bot 的 [R3-1](https://github.com/QwenLM/qwen-code/pull/13135#discussion_r4161801646)（已婉拒）：** 本次未复现，而且它不在 files/1 关闭路径上。
  - files/1 下 `session.mcp` 未设置，所以 MCP 路由在 `mcpBusy` 能被置上之前就返回 `hosted_mcp_unavailable`。
  - 新增的授权后 `session.active` 拒绝，与既有的授权前拒绝一致，后者同样不交还租约。
  - MCP 配置下的变体是否会占住租约，取决于 coordinator 收到 409 后是否重试；这一点未测。

### head 上的定向测试

- **Runtime Broker：** 98 个单测（drain、durable provisioner、恢复、停机执行器），加上 MySQL 8.4.7 上的 `JdbcRuntimeBrokerMySqlIT` 7/7；checkstyle 干净。
- **Managed Agent：** 50 个单测（关闭、生命周期、coordinator、契约、artifact），加上 `WorkspaceSessionCloseMySqlIT` 5/5；checkstyle 干净。
- **`hosted-harness-session.test.ts`：** 在宿主负载 34–44 下完整跑 4 次，其中 2 次 165/165。
  - 另外 2 次失败的是同一个 takeover 用例「reports a parked execution passively…」（load 返回 404），其用例体与 base 逐字相同。
  - 在 head 上单独跑 5/5 通过，在 base 上单独跑 5 次失败 1 次；base 完整跑 2 次中也有 1 次失败在另一个 takeover 用例。
  - 这是本 PR 之前就有的负载相关抖动，CI 的 Test 任务为绿。

### 未覆盖

- Windows。
- 物理断电：VM 重启是真实的内核重启，但属于正常重启。
- 多个 Spring 实例并发；作者的 MySQL IT 覆盖了这一点。
- `HostedPublicWorkspaceIT.durableClose…` 未在本地重跑；CI 已在 Linux 上对这个 head 跑绿（Hosted process fault gates 任务）。

### 复现

装置脚本和探针账本与图片放在一起，位于 `wenshao/qwen-code@assets-pr13135` 的 `pr13135/harness/` 与 `pr13135/results/`。
- **探针：** `s1-close.mjs`（正常关闭）、`s2*/s5`（Turn 与审批拒绝）、`s3`（共享存储）、`s4`（warm 竞态）、`prep` + `closeall` + `s6-ws-after-block` + `watch-blocked`（故障矩阵）。
- **Linux 控制脚本：** `lx/spring.sh`、`lx/harness.sh`、`lx/operator.sh`。

</details>
