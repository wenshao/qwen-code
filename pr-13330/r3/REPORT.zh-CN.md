## 维护者验证第 3 轮（仅增量）— #13330 @ `99f74389`

**结论：代码层面除一处应修缺口外可以合入；这处缺口（F1）的一行修复已在下文验证。PR 描述还不能合入，必须先改写。** 第 2 轮（[评论](https://github.com/QwenLM/qwen-code/pull/13330#issuecomment-6017452336)，`517104bb`）的结论是代码可合入。此后 R3–R6 几轮改了五处生产代码：

- 准入拆分（`6a671b32`，与 `02952ee7` 合并）；
- 饱和门控（`64ce1b1d`、`e5940ae4`）；
- 五条 base URL 规则（`e5940ae4`）；
- 续约不超过租约一半、物化器独立调度器、新的 rename WARN 文案（`c9fd6d04`）。

本轮在 `99f74389` 上重跑了第 2 轮的全部探针，并为上述每项改动各加了一个探针。

**环境。**

- **服务：** 真实的 `ManagedAgentServerApplication`，H2 文件库，内嵌 Runtime Broker 使用 local-process provisioner。
- **worker：** 从 `99f74389` 构建打包的真实 CLI（`pnpm install --frozen-lockfile` 后构建、打包）。
- **平台：** JDK 21（`maven:3.9.11-eclipse-temurin-21`）和 Node 24，Linux aarch64。
- **四个构建，在图 1 中逐一对比：**
  - base：merge-base `3d1412f6`；
  - 第 2 轮 head `924484ef`；
  - head：`99f74389`；
  - head 加 F1 候选补丁。
- **测试套件：** 另在与当前 `main` `9e9d1c03` 的试合并树上跑过（无冲突，树 `eb27de7c`）。
- **重启：** "重启后"指在同一个库上打开第二个应用上下文。

### F1 — `tool-sessions:acquire` 不在围栏内（应修）

![fence by route](r3-fig1-fence.png)

- **现象。** 在 head 上，对 CLOSING、CLOSED、ARCHIVED、DELETED 的非绑定 Session，两个 warm 入口都会拒绝，同进程和重启后都一样（16/16）：
  - `EmbeddedRuntimeBroker.warm()`，即 `HarnessCoordinator` 调用的入口；
  - `POST …/runtimes:warm`。

  但用一个新的 `runtimeSessionId` 调 `POST /internal/runtime-broker/v1/tool-sessions:acquire`，这 8 格全部返回 200，每次都写入一条 READY 的 Runtime binding，并拉起一个 worker 进程。
- **原因。** `6a671b32` 把围栏从共享 resolver 挪到了 `resolveAdmission`，而只有 `warm()` 调用它（`RuntimeBrokerService.java:467`）。对本进程没有持有的 Runtime Session，`acquire()` 走普通解析（`:502`），之后调用 `acquireNewSession → ensureBinding`，会新建 Runtime。
  - 第 2 轮 head 拒绝了这全部 8 格，因为当时的围栏在共享 resolver 里。
  - 第 3 轮针对 R2-1 并行出了两个修复：`02952ee7` 把 resolver 拆成带围栏的 bootstrap 通道（"warm, acquire"）和宽松的 teardown 通道；`6a671b32` 只拦 warm。合并时保留了 `6a671b32`。
- **可达性。** 当前交付的 Harness 触达不到：
  - 生产代码中调用 `tool-sessions:acquire` 的只有 `hosted-workspace-broker.ts`，它服务的是绑定 workspace 的 Session，这些 Session 在围栏之前就已解析。
  - 非绑定的客户端 `BrokerManagedRuntimeProvider` 只在它自己的测试里构造。

  所以要触发它，需要一个持有 Broker token 的调用方直接调用。base 的行为相同，所以相对 `main` 不算回归。
- **为什么仍建议在本 PR 修。** PR 第一条写的是"Runtime Broker 拒绝持久化状态为 closing、closed……的非绑定 Session"，动机是已关闭的 Session 能被"重新 warm 成就绪 Runtime"。一旦接上非绑定 provider，acquire 就会把这个 bug 原样带回来。
- **候选补丁**（一行生产代码加一个参数化见证测试，见上方英文部分的折叠块）：
  - **真实栈：** 24 个关闭类格子里，0 个拉起 worker（图 1 最后一列）。
  - **release 不受影响：** 同进程返回 200；重启后返回 `503 runtime_reconciliation_required`，可重试。
  - **负对照：** 新测试在 head 的生产代码上 6/6 失败，加上修复后通过。
  - **全量测试：** runtime-broker 755/0。managed-agent-server 跑了 1644 个测试（head 的 1638 个加 6 个新用例），唯一的失败是已有的 `RuntimeBrokerDefaultOnTest` 竞态（见最后一节）。

  如果 acquire 本意就要保持开放，另一种做法是把描述收窄为"拒绝 warm"，并在 `RuntimeBrokerService.java:502` 留一行注释说明原因。

### `99f74389` 上的 PR 描述

描述里有些内容仍在讲 `b5bf5b42`，有些地方讲的还是第 2 轮 head。下表每一行都对照本 head 核对过：

| 描述写的 | head 实际 | 证据 |
|---|---|---|
| **风险，"重启后的释放"：** "现在返回 `409 runtime_broker_session_closed`（终态），以前返回 `503 runtime_reconciliation_required`（可重试）"（R3-4） | 返回 `503 runtime_reconciliation_required`，可重试，与 base 相同。只有第 2 轮 head 返回 409，而那正是第 3 轮去掉的 R2-1 死结 | 图 1 下表 |
| "Runtime Broker 拒绝持久化状态为……的非绑定 Session" | 只拒绝 warm，不拒绝 acquire（F1）。设计文档和 README 已经写的是"准入解析（warm）" | 图 1 |
| 租约："续约间隔还必须短于租约"；引用的报错是 "…must be positive and below the lease duration" | 续约间隔须不小于 1 ms，且不超过租约的一半（`c9fd6d04`）。报错现在是 "…at least one millisecond and at most half the lease duration" | 图 2 |
| "Breaking changes: None" | 续约间隔大于租约一半但小于租约的配置（例如租约 60 s、续约 31 s），在 `main` 上能启动，现在启动时会被拒绝。默认值（60 s/20 s）和 e2e 脚本用的 2 s/500 ms 仍能启动 | 图 2 |
| rename："记一条 `Hosted Harness rename failed` 日志"（中英文以及证据表都这样写） | 实际是 `Managed Agent rename failed tenant=… session=…`（`c9fd6d04`） | 图 2 |
| 退避："两次重试之间，该 Session 会被移到较新的 Session 后面" | 只有超过 32 个目标在排队时才会这样做（33 行探测）；低于这个数，物化器只在一次失败尝试之后写入。另外，物化 tick 改到了独立的 `managed-materialization` 调度器上，描述完全没提 | 图 2 |
| base URL："带 host 的绝对 http(s) URL" | 还会拒绝 userinfo、query 和 fragment，与 `HostedHarnessClient.normalizeBaseUri` 一致 | 图 2 |
| 测试计划："在 `b5bf5b42` 上 `Tests run: 131`" | 本 head 上是 194 个（EmbeddedRuntimeBroker 28、QwenHostedHarnessConnector 57、HarnessEventProjector 9、EventIdentity 4、HarnessCoordinator 62、ManagedSessionLifecycle 25、MessageMaterializer 7、ManagedMaterializationDefer 2） | 图 3 |
| 测试清单 | 漏掉了变异扫描所依赖的见证测试（图 3）：`releaseStillSettlesAnUnboundClosedSession`、`reconcileStillAnswersAnUnknownExecutionOfAClosedSession`、`teardownReleaseStillResolvesTheScopeWhenAdmissionIsFenced`、`anExactlyFullWindowDoesNotRotateOnTheSkipPath`、`materializeRunsOnItsOwnScheduler`、`warnsWithTheStackOnlyDuringTheExponentialPhase`、`aHarnessFaultedRenameLogsAndChainsTheRootCause` | 图 3 |
| 证据："改动后是 `b5bf5b42`"，以及"在本 PR 涉及的每个文件上，当前 `main` 与 [`43a6e1e5`] 只差一行注释" | `43a6e1e5 → main` 在其中 18 个文件上现在是 +5165/−413。我在 `3d1412f6` / `99f74389` 上重测了两列，结论不变：40 s 内 WARN 行数 377 → 13，饿死从"始终没有"变成 23 ms。可以用本轮的数字替换原表 | 图 2 |
| CI："[MySQL / MariaDB 两条车道] 都因超时被取消……由 #13542 跟踪" | 两条车道在 `99f74389` 上都是绿的，#13542 已于 10 月 7 日关闭。本 head 上所有检查都通过 | `gh pr checks` |

bot 为"重启后的释放"一条准备的可直接粘贴替换文本（[thread](https://github.com/QwenLM/qwen-code/pull/13330#discussion_r4235998230)），与我的实测一致。

### `99f74389` 上成立的部分

![operability](r3-fig2-operability.png)

- **warm 围栏：** 两个 warm 入口对四种关闭状态都会拒绝，同进程和重启后都一样。本进程持有的 Runtime Session 仍能正常 release（200），R2-1 死结保持修复状态。
- **物化器：** 单个被污染的 Session 在 40 s 内产生 13 行 WARN（base：377），写 13 次 progress 行。排在 33 个被污染 Session 之后的健康 Session 23 ms 内完成物化（base：15 s 内始终没有）。
- **饱和门控（R4）：** 恰好 32 个被污染 Session 时，没有跳过路径的轮换（3 次写/秒，都发生在失败尝试之后）；33 个时才开始轮换。
- **独立调度器（`c9fd6d04`）：** 我持有行锁，让物化器阻塞 25 s。base 上阻塞的是 `scheduling-1`，默认调度器上一个 100 ms 的任务在 250 次里只跑了 2 次（最大间隔 10.1 s）。head 上阻塞的是 `managed-materialization-1`，该任务跑了 248/250 次（最大间隔 102 ms）。
- **启动校验：** head 拒绝全部 6 种非法 base URL 形态和全部 5 种非法租约设置。大写的 `HTTP://`、续约恰好等于租约一半、默认值和 e2e 配置仍能启动。
- **对宕机 Harness 做 rename：** 记一条带 `ConnectException` cause 的 WARN（base：0 行日志）。
- **Kubernetes：** 使用新文案。
- **工具 item 身份：** base 和 head 一致。三种事件顺序下都只有一个 item；base 构建存下的 `tool_call` 在升级后仍能与它的 update 合并。

### 测试与变异

![suites and mutation](r3-fig3-tests.png)

- **全量测试：**
  - runtime-broker：head、试合并、候选补丁上均为 755/0。
  - managed-agent-server：head 1638 个、试合并 1650 个、候选补丁 1644 个，除 `RuntimeBrokerDefaultOnTest` 竞态外都是 0 失败。base 跑 1606 个，两次全量运行中有一次也碰到了同一个竞态。
- **变异扫描：** 针对 R3–R6 代码的 41 个变异体，聚焦测试集杀死 36 个，每个都由对应的见证测试杀死。5 个存活体在全量测试上同样都没有被杀死。其中两次运行额外出现了 `ToolPublicationStoreTest`、`ManagedActionsTest` 的错误，但在同一变异下单独重跑这两个类都能通过：
  - **a04**（单参数的 `resolveAdmission` 覆盖不拦）：等价变异体。Broker 只调用双参数形式，而嵌入式 resolver 覆盖的正是双参数形式。
  - **c03**（续约恰好等于租约一半时被拒）：边界没有被测试钉住，评审已将其列为延后项。实测确认租约 60 s、续约 30 s 能启动。
  - **d05 / d06**（启动校验拒绝 `https`，或拒绝大写 scheme）：校验对 https 的放行一侧没有任何测试。如果一次回归让所有 `https://` 的 Hosted Harness URL 都被拒（这正是生产环境的形态），测试照样全绿。在 `rejectsSchemelessBaseUrlsAtStartup` 里加两个应放行的用例（`https://harness.example`、`HTTP://127.0.0.1:4170`）即可钉住。
  - **h03**（defer 的 `UPDATE` 忽略 `tenant_id`）：没有被钉住，评审已将其列为延后项。

### 观察（无需处理）

超过 32 个 Session 同时失败时，跳过路径的轮换每秒约发出 300 条单行 `UPDATE`（实测 307 条/秒）：每轮 100 ms，每个排队目标一条。这是修复饿死问题的代价。base 不发这些写入，但会饿死健康 Session，同时每秒记约 250 行 WARN。

### 未覆盖

- 本地没有跑 MySQL 8.4 和 MariaDB 车道；CI 在本 head 上两条都是绿的。
- 全部只在 Linux aarch64 上运行。qwencode 和 runtime-broker 的 x86、macOS、Windows 由 CI 覆盖。
- 本轮没有重跑 hosted 全栈 IT。F1 的可达性来自阅读调用方代码。
- `RuntimeBrokerDefaultOnTest.defaultCombinationBootsWithTheYmlDefaultsBound` 是已有的竞态，不是本 PR 引入的。在这里的全量运行中，它在 base 上 2 次失败 1 次，在 PR 构建上 9 次失败 7 次；单独运行时两边都是 4/4 通过。诊断版本给出了原因：测试调用 `scan()` 时，定时的 5 s `recoverSavedRuntimes` 正持有 `running` 闩锁，结果取决于那一轮是否已经执行到查询。本 PR 没有改这个测试，第 1、2 轮也记录过同一个竞态。本 head 上 x86 的 CI 是绿的。

证据（探针、日志、变异结果、图）：this directory (`data/`, `harness/`)
