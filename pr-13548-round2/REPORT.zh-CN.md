## 维护者验证第 2 轮（仅增量）：QwenLM/qwen-code#13548 @ `8deb72ee`

**结论：可以合入。** 第 1 轮提出的各项在本 head 上均已关闭；我用第 1 轮的同一批探针原样重跑，逐项确认。
- 两条运行 `managed-agent-server` 的 CI 车道在本 head 上均为绿（第 1 轮时均被取消）。
- 剩下一项不阻塞的问题：变异体 53（见下文），这一点我用执行再次确认了第 1 轮的结论；另有一处措辞层面的小问题。

完整矩阵见[第 1 轮](https://github.com/QwenLM/qwen-code/pull/13548#issuecomment-6031765367)。本轮验证对象是 head `8deb72ee`，A/B 对照臂是当前 `main` `1aba19c8`（即新的合并基）。环境与上一轮相同：Linux x86_64、JDK 21.0.10、Node 22.22.2。

### 已关闭（执行确认）

- **R1-1 资源闭包：已关闭。** Java store 现在会拒绝下面两种提交，返回 `409 managed_session_resource_missing`，且 0 行入库；第 1 轮时两者都被接受并建了索引：
  - 缺少 `policyRef` 资源的 route；
  - 3 个资源一个都没发送的 delivery。

  `verifiesTheChannelResourceClosure` 现在能被测试框架发现（store 套件 26/26）。新增的 4 个 store 变异体（分别删掉 policy、content、分段 content、proof 的闭包检查）都会被这个测试杀死。
- **R1-2 稀疏计划：已关闭。** 同样带空洞的计划现在在提交时就被拒绝，Session 可以正常重开。
  - 把逐下标遍历改回去的变异体，会被新增的稀疏回归测试杀死。
  - 字节级差分表达不了空洞，所以这条规则只靠该测试和 `delivery-null-segment` 来钉住。
- **F1 无证据的 unknown → partial：已关闭。** 以下三处现在都会拒绝这一步：
  - 两个验证器；
  - TS authority（`ManagedSessionConflictError … cannot follow revision 4`，序号停在 4）；
  - Java store（`409`）。

  对照的 `main` 上，channel 正文尚未注册，所以整条链仍被不经校验地全部接受。迟到回执的合法路径 `unknown → delivered` 仍可提交，语料也不再能拼出这条绕过路径。

  新规则的两个方向在两种语言中都被钉住了：
  - 删掉规则的变异体，被 `delivery-unknown-partial-without-proof` 杀死；
  - 把规则收紧成“永不允许”的变异体，被 `delivery-unknown-proves-partial` 杀死。
- **F2 语料缺口：12 个关闭了 11 个。** 第 1 轮的 12 个活变异体里，有 11 个现在在两种语言中都被 PR 套件杀死：
  - 击杀率：TS 62/68，Java 59/65（第 1 轮分别为 48/65、42/59）。
  - 7 个 authority/projection 变异体和比较器回退变异体同样被杀死。
  - 存活的只剩同样那 5 个等价变异体，以及变异体 53。

### 变异体 53（不阻塞）

你的回复说得对：原版解析器拒绝 `delivery-receipt-bad-time` 时报的确实是 `acceptedAt` 的错误，因为解析顺序上时间检查在前。问题在于，两种语言的回放测试都只断言“解析会抛错”，并不断言是哪条规则触发的。

- **为什么还活着：** 删掉 `acceptedAt` 检查后，这个 fixture 仍会被拒绝，只是换成了“planned 不得有回执”这条规则拒绝，所以套件依然是绿的。在本 head 上，T53 和 J53 在两种语言里都没被语料杀死；fuzz 则分别用 98 和 99 个输入把它们杀死了。
- **修法：** 把同一张回执放到 `sending` 运行上，就能单独隔离这条规则（原版拒绝，变异版接受）。所以把这个 fixture 移到 `sending` 运行上即可钉住；也可以在两边的回放中断言拒绝信息。

### 门禁、差分与 CI

- **TS 套件：** PR 套件 331/331（channel 151、projection 170、authority 10）。`src/managed-runtime` 2600/2600，`main` 为 2439/2439，差值 161 = 151 + 10。本机未出现 `hook-scale` 超时。
- **Java：** 9 个门禁类 60/60。`managed-agent-server` 全模块运行 1258 个测试，0 失败、0 错误、2 跳过。
- **新语料（92/57）上的差分：**
  - 4,151,341 个输入，0 分歧；149 个锚点在两侧都与 fixture 一致。
  - 覆盖面：11/11 组合、18/18 步进；`unknown → partial` 只在带新回执时被接受。
- **CI，MariaDB 车道**（`Runtime Broker and Managed Agent MariaDB`）：本 head 上**成功**，07:48 → 07:58Z。
  - 模块 1258/0/0，MySQL IT 53/53，store 26/26，channel 合约 2/2，`ManagedSessionStoreIntegrationTest` 5/5。
  - 日志中不再有超过 10 万字符的行，上一轮的旧基线卡死问题已消失。
- **CI，Hosted 车道**（`Hosted process fault gates / MySQL 8.4`）：本 head 上**成功**，07:48 → 08:16Z。
  - 两遍模块测试均为 1258/0/0，store 26/26，`ManagedSessionStoreIntegrationTest` 5/5，O4 48/48。
  - 日志中没有超过 10 万字符的行。

### 小问题（措辞）

- channel 引用现在走共享的 `ManagedExtensionRecordStore.requireReference`，而它的报错文案是 “The MCP reference does not match its committed resource.”。
- 我实际执行确认过：一个 digest 与已发送资源不一致的 `policyRef` 会被正确拒绝，但报错用的是这句 MCP 文案。
- 改成中性的措辞，对运维排障更友好。

证据（截图、探针、变异日志、原始数据）：本目录下的 `harness/` 与 `data/`
