## 第 2 轮验证 — 对 [5775293028](https://github.com/QwenLM/qwen-code/pull/12445#issuecomment-5775293028) 的补充 — PR #12445 @ `15d395bc`

`15d395bc` 落地了上面第 2 轮评论中的编解码修复，并在契约里加了有效租约拒绝的检查。它对 float/double 的比较走了与那条评论的补丁不同的路线（按 JSON token 比较，`BrokerValues.jsonNumber`），这部分我只通过门禁确认过。我在这个 head 上重跑了自己的探针：门禁 63/63，Checkstyle 0。本评论补充第 2 轮评论和这个提交都没有覆盖的三项：

- **第 1 项：** 之前被推迟的会话时区时钟。
- **第 2 项：** 已合入的服务层里的一条重复执行路径。
- **第 3 项：** 针对仍存活变异体的测试。

第 1、2 项涉及的是本 diff 之外、但以这张表为数据来源的代码，而且目前还没有任何地方把服务层接到这张表上，所以不应阻塞本 PR。其中只有第 1 项的第一种情形不需要第二个 broker：服务层一旦跑在这张表上，单个 broker 就会遇到，所以我建议在接入之前修掉。其余都要等多 broker 派发启用后才会出现，应在第二个 broker 能驱动同一个调用之前修掉。

### 1. 已推迟的会话时区问题：`15d395bc` 上的实测

`databaseNow()` 执行 `SELECT CURRENT_TIMESTAMP`，并用 UTC 日历读取结果，所以它打出的租约时间跟随 MySQL 会话的 `time_zone`。这是 #12390 的发现 1，也是本 PR 中 chiga0 的 M1，作者已推迟到全模块统一修改。

`RuntimeBrokerService` 用自己的 `Clock.systemUTC()`（`:63`）比较这些租约，位置在 `:222-223` 和 `:994` 的 `hasLiveDispatchAt(clock.instant())`。只有偏移为 0 的 UTC 会话时区，才能让服务层和仓库层使用同一个租约时钟（误差为宿主机与数据库之间的时钟偏差）。以下在 MySQL 8.4.11 上实测（图 C 第 2 部分、图 A）：

- **会话时区落后于 UTC：只需一个 broker 即可触发。** 所有会话都用 `America/New_York` 时，服务层会把一个刚发放的租约读成已过期。对正在运行的调用执行 `cancelExecution`，这一行被标为 `CANCEL_REQUESTED`，随后进入重新驱动分支（`:217-229`），而不是调用 `transport.cancel`（`:234`）。这个分支立即返回，因为该调用自己的派发仍在进行中。经真实服务 API 实测：取消一次再重试一次后，`transport.cancel` 共被调用 0 次，UTC 对照组是 2 次。取消信号根本没有送达运行时。
- **会话时区领先于 UTC（`TZ=Asia/Shanghai` 的服务器，Connector/J 默认配置）。** 宕掉 owner 的 `EXECUTING` 行，在拿到 1 秒租约 2.5 秒后（已过期约 1.5 秒），对服务层来说仍然有效（`shouldDriveDispatch=false`）。仓库层已认为这个租约过期：此时抢占返回 null，并把这一行转为 `UNKNOWN`。服务层约 8 小时内都不会重新驱动这一行。等另一个 broker（或重启后的 broker）能驱动这个调用时，这一点才开始有影响。
- **两个时区不一致的连接池**（图 A：UTC 默认对比 `connectionTimeZone=Asia/Shanghai&forceConnectionTimeZoneToSession=true`），同样要等另一个 broker 能抢占时才会出现：
  - A 的 30 分钟 claim 仍有效，B 的抢占却被批准，A 随后被挡住；
  - 一个仍有效的 `EXECUTING` 行变成 `UNKNOWN`，A 的结算被拒；
  - 反方向上，一个已失效的 1 秒租约会把这个调用阻塞约 8 小时（探针测得还剩 479 分钟）。

作者第一轮的处理说明（[5772225768](https://github.com/QwenLM/qwen-code/pull/12445#issuecomment-5772225768)）提到用 `UTC_TIMESTAMP()` 来做这次修改，并配合 H2+MySQL 交叉验证。但这个交叉验证会立刻失败，#12390 的验证里已经说明过：H2 2.3.232 在 `MODE=MySQL` 下会报 `Function "UTC_TIMESTAMP" not found`。#12390 第一轮验证里给出了一个 `UNIX_TIMESTAMP(CURRENT_TIMESTAMP(6))` 版本，在 MySQL 和 H2 上都验证过；它在 H2 上返回整秒。

### 2. broker 可能执行一个已归其他 broker 所有的调用（已合入的 #12438 代码）

这个问题今天是潜伏的。一个进程遇到不是自己 provision 的 binding 时，服务层以 `runtime_reconciliation_required` 失败关闭（`RuntimeBrokerService.java:570-578`；接管 Runtime 是列明的非目标）。所以一个调用只能由一个 broker 驱动；在同一进程内，`dispatches` 还会合并同一个调用的并发派发。

一旦启用这张表本来就要服务的多实例派发（"add JDBC Tool execution persistence for multi-instance dispatch convergence"，`managed-runtime-broker-service-core.md:97`），它就能触发。

路径如下：broker A 抢占后，在进入 `EXECUTING` 的 CAS 之前停顿超过了租约期；broker B 抢占并把这一行推进到 `EXECUTING`。于是 A 的 CAS 失败：

1. `enterExecuting` 重读这一行，发现 owner 已变，就把这一行原样返回（`:706-707`）。
2. `dispatch()` 只检查 state 是否为 `EXECUTING`（`:664-669`）。
3. `dispatch()` 随即调用 `transport.execute`（`:680`）。

B 已经把这一行推进到 `EXECUTING`，而 broker 正是在执行前一刻才这样做，所以 A 这次调用是同一个工具调用的第二次执行。A 自己的结算随后会被拒绝，但副作用已经发生了两次。

用 JDBC（H2）和内存两种仓库实测（图 C 第 1 部分）：B 已进入 `EXECUTING` 时，A 调用 `transport.execute` 1 次；B 只是抢占时，调用 0 次。探针里的 B 直接操作共享的仓库。

**修复：** 在 `dispatch()` 里加一个条件 `|| !ownsDispatch(executing, claimed)`（+2/−1，[`service-owner-check-15d395bc.patch`](./service-owner-check-15d395bc.patch)）。加上后，四个臂里 A 的次数都是 0，门禁通过（Checkstyle 0，63/63）。这个修复目前还没有回归测试，可以参照 `TakeoverRaceProbe` 的形式来写。

一旦第二个 broker 能驱动同一个调用，A 在抢占和 CAS 之间停顿超过派发租约期就足以触发它；在第 1 项的时区不一致下，连停顿都不需要，只要 B 的会话时区领先于 A，并且 B 的操作落在 A 正常的抢占→CAS 窗口之内。我建议作为 #12438 的后续，在接管（adoption）功能落地之前处理。

### 3. 针对 `15d395bc` 上仍存活变异体的契约测试

第 2 轮评论说，它的 lock-step fuzz 在 M22 之外还抓到 12 个存活变异体，其中点名了 M09、M18、M38，并建议移植。`15d395bc` 加了有效租约拒绝检查，但没有加这些测试，也没有加针对行锁的并发测试。

[`fence-tests-15d395bc.patch`](./fence-tests-15d395bc.patch) 新增两个由 `verify` 调用的方法（+160 行）。编号来自同一套变异集，用那条评论自带的生成器 `mutants66.py` 构建（图 B）：

- **M50（行锁）：** 6 轮、每轮经两个实例并发 32 次抢占，每轮必须只授予一次。
- **M04：** 复用 `executionCallId` 抛 `IllegalArgumentException`。
- **M45：** 非新建的候选会抛异常，不论它是 version 非零还是 state 不是 `PREPARED`。
- **M18：** 一次 CAS 让 version 恰好加一。
- **M09、M31、M33、M39：** 行一旦结算：
  - 结果不可再改，对它自己的 owner 也一样；
  - 续租被拒；
  - 取消被拒；
  - `resolveUnknown` 被拒。
- **M14：** 同一 owner id 在 generation 2 重新抢占后，一个重读了新行的 generation-1 写者会被拒。
- **M29：** 租约过期后续租被拒。
- **M34：** 在当前版本上重复取消不产生任何变化。
- **M10、M30、M38：** owner 把自己的调用停到 `UNKNOWN` 后，这个调用既不能 CAS，也不能续租，只能在当前版本上经 `resolveUnknown` 离开。
- **M53、M54、M56、M57、M58：** payload 比较：
  - 与重新加载的行比较：嵌套的 `Long` 和列表元素判等，多出一个键或列表变短判为不等；
  - 两个候选之间比较：值为 null 的键改名判为不等。

在 `15d395bc` 上，杀伤从 28/60 提升到 **47/60**，原本被杀的变异体没有一个转为存活。剩下的 13 个存活者，要么需要伪造快照、篡改过的行，或只有包内代码才能传入的参数，要么是等价变异。打上补丁后门禁通过（Checkstyle 0，63/63）。竞争测试是概率性的。这次扫描同时并行跑 6 个变异套件，它杀掉了 M50。在 `f724def` 上，同一段竞争测试在 6 路负载下 18/18 次杀掉了同一种变换（`logs/c18-under-load.log`，当时编号为 C18）。

证据在 [`pr-12445-round2-delta/`](.)：探针及其确切调用命令（`harness/COMMANDS.md`）、`run_round2_mutants.sh`、逐个变异结果、门禁日志、两个补丁和图。

![图 A — 会话时区不一致的两个连接池](figA-mixed-session-timezone.png)

![图 B — 契约测试对第 2 轮变异集的效果](figB-fence-block-mutants.png)

![图 C — 基于这个仓库的服务层效应](figC-service-level.png)
