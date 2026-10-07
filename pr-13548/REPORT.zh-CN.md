## 维护者验证：QwenLM/qwen-code#13548 @ `8b283d1c`（H5a Channel 记录契约）

**结论：两个语言的验证器判定完全一致，本切片如描述所说处于惰性状态。把分支更新到 `main` 后即可合入；但建议先处理 F1（或明确记录给 H5c），因为正是本 PR 冻结了这份语料。**

- **F1（契约缺口，Suggestion）。** "`unknown` 的交付绝不回到 `sending`"只在直接一步上生效。已提交的语料自身就接受"无新回执的 `unknown → partial`"再接 `partial → sending`；真实 TS Session authority 与真实 Java Session store 都会提交这条链（§3）。
- **F2（语料强度，非阻塞）。** 有 12 条规则两种语言实现一致，却没有任何 fixture 钉住；另有 2 个 fixture 实际被拒的规则与其名字所指的不同（§4）。
- **CI。** 本 head 上两条运行 `managed-agent-server` 的车道都被取消。原因是基线过旧，与本 diff 无关：一个在 PR 基线上坏掉、已由 `main` 上的 #13551 修复的测试，会打出一条 1.3 MB 的日志行，把 runner 拖到 job 时限。head 合入 `main` 后本地全绿：1248 个模块测试，0 失败（§5）。

以下全部为实际执行结果。**环境：** Linux x86_64（16 核）、JDK 21.0.10、Maven 3.9.9、Node 22.22.2。**三棵树：** merge-base `ac497aee`、head `8b283d1c`、head 合入 `main` `f07c190c`（合并提交 `317feb8c`，干净，无冲突）。

### 1. 门禁

![gates](fig1-gates.png)

- **head 上的 PR 套件。** PR 的 TS 套件 318/318；Java 门禁类在 JDK 21 上 48/48。
  - 测试计划里还列了 `ManagedMonitorRecordContractTest`，但全仓都不存在这个类；其余 8 个类正常运行。
- **`src/managed-runtime` 全量。** 三棵树都通过：base 2172/2172、head 2320/2320、合并树 2426/2426。描述中提到的 `hook-scale` 超时在本机未复现。
- **合并树。** 9 个 Java 门禁类 53/53，其中包括 `ManagedSessionStoreIntegrationTest` 5/5。`managed-agent-server` 全模块运行 1248 个测试：0 失败、0 错误、2 跳过。

### 2. TS ⇄ Java 差分：460 万输入，0 分歧

![differential](fig2-differential.png)

**输入。** 三种生成器同时喂给两侧：
- fixture 种子；
- 语义采样器，覆盖 投递线状态 × 运行状态 × 原因 × 回执 × 取消标志；
- 随机结构噪声。

在此之上还会改写数字的拼写（`1.0`、`1e0`、`-0.0`、`1E+0`）、打乱键序、对字符串做 `\u` 转义。

**方法。** 两侧用各自的生产解析器解析**同一份原始字节**：TS 用 `JSON.parse`，Java 用与 `ManagedExtensionRecordStore` 完全相同配置的 Jackson。随后各自运行已注册的正文：parse、`isStart`、`isSuccessor`。

**结果。**
- 4,601,644 个输入，判定分歧 0，两侧非契约异常 0。
- 11 种可达的（投递线状态，运行状态）组合，以及全部 18 种 channel 投递线步进（7 种停留 + 11 种迁移），都至少被接受过一次。所以这不只是"在拒绝上一致"。
- 该 harness 确实能检出真实分歧：把 Java 比较器回退成 `JsonNode.equals`（即描述中提到的那个评审修复），会产生 11,022 条分歧（§4 的变异体 S0）。

### 3. F1：`unknown` 不需任何新证据，两步即可回到 `sending`

![unknown bypass](fig3-unknown-bypass.png)

决策 5 禁止 `unknown` 之后的自动重发。记录正文一节写道：*"`unknown` 的交付绝不回到 `sending`（重发使用新 `deliveryId`，决策 5）……而解决 `unknown` 的迟到回执仍可提交"*。验证器只拒绝**直接**一步。

1. **语料本身就逐字节拼出了这条绕过路径。**
   - `delivery-unknown-proves-partial`（valid）的前后回执完全相同，并没有证明任何东西。
   - 它的 `after` 与 `delivery-partial-resumes`（valid）的 `before` 逐字节相同。
   - 而后者的 `after` 又与被钉为**非法**的 `delivery-unknown-never-resends` 的 `after` 逐字节相同。
2. **真实 TS Session authority。** 按 PR 的 authority 套件同样的方式 mock 掉 domain 启用检查后，我提交了 `planned → sending → seg-1 已证 → unknown → partial（无新回执）→ sending → delivered`（seg-2 带第二张回执）。
   - 7 个修订全部提交成功。
   - 重新打开后重建为 revision 7、`delivered`。
   - 直接的 `unknown → sending` 被拒，且没有提交任何内容。
3. **真实 Java Session store。** 同一份探针代码分别跑在 base 和 head 上（H2 上的 Spring 上下文，经 `ManagedSessionStore.commit` 提交）。
   - **head：** store 现在会强制执行这两个正文，这正是预期的"store 先于写入者"变更。直接一步和畸形的 `delivered` 正文都会得到 `409 managed_session_extension_record_rejected`；而在 base 上，两者都会被不经校验地接受。
   - **head 上仍被接受：** 两步链，并被索引为 `channel_delivery@rev7`、`delivered`。

目前还没有任何生产者，所以今天没有运行时影响；但 H5c 的派发器要依靠这份契约来阻止重复发送。有两种自洽的解法，由作者决定：

- **(a) 离开 `unknown` 进入 `partial` 必须带证据。** 我验证了一个候选修复（未推送；见图 4 与 [`candidate-fix.patch`](harness/candidate-fix.patch)）。
  - **规则：** 两个验证器都要求 `unknown → partial` 必须结清至少一段在 `unknown` 时尚未结清的分段。
  - **语料：** `delivery-unknown-proves-partial` 增加第三段并带一张真实的新回执；原来的形状改成拒绝用例 `delivery-unknown-partial-without-proof`。
  - **结果：**
    - TS 319/319，Java 29/29。
    - 修复版 TS 对修复版 Java，30 万输入 0 分歧。
    - 相对 head，恰好有 73 个输入的判定发生变化，全部是回执数不变的 `unknown → partial`。
  - **局限：** 该规则假设分段按顺序派发。如果收到的是后面某段的回执，前面那段状态未知的分段仍可能被重发。
- **(b) 允许 provider 查询证明"未发送"之后恢复发送。** 如果要允许这种情况，记录需要一个承载该证明的字段，文档里那句话也要收窄。目前正文无法区分"有证据的恢复"与"自动恢复"。

![candidate fix](fig4-candidate-fix.png)

### 4. F2：独立变异测试，124 个变异体

![mutants](fig5-mutants.png)

**变异体构成：**
- 58 个规则删除变异体，两种语言按编号一一镜像；
- 4 个 authority 闭包变异体；
- 3 个 projection 变异体；
- Java 比较器回退变异体。

每个变异体都先跑 PR 自己的套件，再用 30 万条差分输入与**另一种语言**的原版对拍。

**击杀率。** PR 套件杀死 TS 48/65、Java 42/59，7 个 authority/projection 变异体全部被杀。幸存者在两种语言中**完全相同**：12 个活变异体（全部被 fuzz 抓到）和 5 个等价变异体。

**5 个等价变异体：**
- target 钉约束（`deliveryId` 恰在 target 为 channel 时设置）；
- start 回执检查（planned 已钉死零回执）；
- ordinal 比较（ordinal 从零起稠密）；
- `deliveryId` 漂移与 `routeId` 漂移（`effectId` 只能写一次）。

**没有任何 fixture 钉住的规则**（各需补一个 fixture）：
- `thread` 作用域带 `senderId`；
- `single` 作用域带 `chatId`；
- 未知 scope kind 且载体全空；
- 非布尔的 `cancelRequested`；
- `unknown` 且所有分段都有回执；
- `rejected` 且所有分段都有回执；
- route `accountId` 漂移；
- delivery `routeId` 漂移；
- 畸形 `proofRef`；
- 畸形分段 `contentRef`。

**有两个 fixture 被拒的规则与其名字所指的不同：**
- `delivery-cancelled-with-receipt` 沿用模板的 `cancelRequested: false`，所以是被取消标志子句拒绝的，零回执规则并未被钉住，变异体 29 因此存活。这一点更正了 triage 评审"该 fixture 钉住了这条拒绝"的说法。
- `delivery-receipt-bad-time` 基于 `planned` 模板，在检查 `acceptedAt` 之前就被"planned 不得有回执"拒绝，变异体 53 因此存活。

修法：把前者的 `cancelRequested` 设为 `true`，并把回执形状类 fixture 移到 `sending` 的运行上。

这些数字与描述中的 22 + 17 不可直接比较：那组是手工挑选的，本组则对每个规则子句逐一删除。

### 5. 本 head 上的 CI

![ci](fig6-ci.png)

- **哪些车道覆盖 Java 镜像。** 在 `sdk-java.yml` 中，只有 `Runtime Broker and Managed Agent MariaDB` 和 `Hosted process fault gates / MySQL 8.4` 两条车道运行 `managed-agent-server`；五条 OS 车道只跑 `qwencode` 和 `runtime-broker`。因此 OS 车道全绿并不覆盖 Java 镜像，这与 triage 的 CI 说明不符。
  - Hosted 车道在卡住之前确实跑过：`ManagedChannelRecordContractTest` 2/2、`PlannedChannelContractTest` 3/3、`ManagedExtensionRecordStoreTest` 19/19、`ManagedExtensionProjectionContractTest` 8/8。
- **失败的是什么。** Hosted 车道唯一的错误是 `holdsRestorePagesInsideThePerPageByteBudget`。该测试在 PR 基线 `ac497aee`（2026-10-06 17:01Z）上就是坏的，`main` 于 00:43Z 由 #13551 修复。
  - MariaDB 车道的日志在 4.2 MB 处被截断，看不到该测试的输出；它在 20 分钟处被取消，与 #13551 提交说明中描述的 `main` 上该车道的情况一致。
- **为什么是取消而不是失败。**
  - 该测试的 MockMvc 失败转储是一条 1,334,121 字符的单行日志。
  - Hosted 日志中这一行前后的时间戳为 03:46:20 → 04:05:47 → 04:25:06，之后 job 触及时限。
  - `main` 在 #13551 之前的运行（`ac81c07d`、`b5855087`）也出现了同一条长行、同一个错误和同样的取消。
- **结论。** 本线程早前"runner 变慢"的归因不适用于这两条车道：在这个基线上它们是确定性失败。把分支更新到 `main` 后，两条车道应会转绿，与本地合并树的结果一致。

### 未验证

- 真实 MySQL/MariaDB：store 探针跑在 MySQL 模式的 H2 上；本 PR 没有任何 SQL 或 Flyway 改动。
- macOS 与 Windows：这两个平台的 TS 车道被路径过滤跳过。
- 任何 H5b/H5c 运行时：目前尚不存在。

证据（截图、harness、原始数据、变异体清单、候选补丁）：本目录下的 `harness/` 与 `data/`
