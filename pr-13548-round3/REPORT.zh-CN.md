## 维护者验证第 3 轮（仅增量）：QwenLM/qwen-code#13548 @ `b3d3c089`

**结论：仍可合入。** 本轮唯一的生产改动，是把 `ManagedExtensionProjection.RECORD_BODIES` 从 `Map.of` 换成 `Map.ofEntries`。这个改动是必要的，也是正确的。其余内容都没有变：验证器、两份语料、PR 自带测试和 store 闭包，都与第 2 轮的 `8deb72ee` 逐字节相同。唯一不属于本 PR 的变化，是合入了带 H6a（#13536）的 `main`。两条编译 `managed-agent-server` 的 CI 车道在本 head 上均为绿。

[第 1 轮](https://github.com/QwenLM/qwen-code/pull/13548#issuecomment-6031765367) · [第 2 轮](https://github.com/QwenLM/qwen-code/pull/13548#issuecomment-6033913905)。本轮验证对象是 head `b3d3c089`，A/B 对照臂是当前 `main` `e31d5500`。

- **这个修复是必要的。**
  - 修复前的合并提交 `4b2a498d` 往 `Map.of` 里放了 11 对，`javac` 报错：`no suitable method found for of(String,Body,…)`。
  - 它与 `b3d3c089` 只差这一个文件，而 head 能编译通过。
  - 这正是 [08:21Z 评审](https://github.com/QwenLM/qwen-code/pull/13548#pullrequestreview-5439552330)预言的跨 PR 断裂：`main` 与第 2 轮 head 各自都只有 9 对，合在一起才超限。
- **这个修复是正确的。**
  - 两种语言的注册表一致：Java 的 `RECORD_BODIES` 和 TS 的 `MANAGED_EXTENSION_RECORD_BODIES` 都是同样的 11 个键。
  - 两个 channel 正文在 Java 侧的 `taskKind` 仍为 null。
  - projection fixture 用 `recordBodies`（9 个）加上 H6a 的 `additionalRecordBodies`（2 个）覆盖了全部 11 个键；两种语言的一致性测试都会把这两个 map 合并后再比对。
- **门禁。**
  - TS：PR 套件 331/331；`src/managed-runtime` 2697/2697，`main` 为 2536/2536，差值仍正好是 151 + 10。
  - Java：11 个门禁类 67/67，其中包括 H6a 的 `ManagedAutomationRecordContractTest`；`managed-agent-server` 全模块 1262 个测试，0 失败、0 错误（2 跳过）。
  - 差分：4,001,192 个输入，0 分歧。
- **第 2 轮探针原样重跑。** 以下三项依旧关闭：
  - R1-1：返回 409 `resource_missing`；
  - R1-2：在提交时即被拒；
  - F1：TS authority 与 Java store 都拒绝。
- **第 2 轮遗留的两项，仍未处理，均不阻塞。**
  - 变异体 53：`delivery-receipt-bad-time` 逐字节未变；删掉 `acceptedAt` 检查后，它仍会被 planned 的钉约束拒绝。把它移到 `sending` 运行上，即可钉住这条规则。
  - 共享的 “The MCP reference does not match…” 报错文案：现在 channel 引用也会走到这句；[yiliang114 的 P3](https://github.com/QwenLM/qwen-code/pull/13548#discussion_r4204851717) 也提了同一点。

**变异测试本轮未重跑。** 它所变异或回放的所有文件都与第 2 轮逐字节相同，因此第 2 轮的结果（TS 62/68、Java 59/65）可以直接沿用。

**`b3d3c089` 上的 CI。** 五条 OS Java 车道全绿，但它们只构建 `qwencode` 和 `runtime-broker`。本次修复所在的 `managed-agent-server` 只有两条 DB 车道会编译。
- `Runtime Broker and Managed Agent MariaDB / Java 21`：**成功**，09:01 → 09:13Z。
  - 模块 1262/0/0，以 `Map.ofEntries` 编译。
  - MySQL IT 53/53，`ManagedAutomationRecordContractTest` 4/4，store 26/26，channel 合约 2/2。
- `Hosted process fault gates / MySQL 8.4 / Java 21`：**成功**，09:06 → 09:40Z。
  - 两遍模块测试均为 1262/0/0，store 26/26，`ManagedSessionStoreIntegrationTest` 5/5，O4 48/48。
  - 日志中没有超过 10 万字符的行。

证据（截图、负对照 javac 输出、日志）：本目录下的 `harness/` 与 `data/`
