## 维护者验证：PR #13013 @ `77ae21c937`

**结论：harness 改动正确，做到了它声称的事。把 `Fixes #13009` 改成 `Refs #13009` 之后，可以作为测试基础设施改进合入。** PR 描述里的每一条行为结论都在全新的本地构建上复现了，包括“每次多约 5 秒”，这一条我用真实模型重新测过。但 PR 声称修复的失败（#13009）是一台 macOS runner 上的 DNS 故障，本改动不可能影响 DNS。原样合入会以错误的根因自动关闭这个跟踪 issue。这就是一直挂着的 R1-1，我已经从原始 job 日志独立复核了它。

**环境。** Linux 6.12 x86_64，Node 22.22.2，pnpm 11.24.0。在 `77ae21c937` 上全新执行 `pnpm install --frozen-lockfile`、`npm run build`、`npm run bundle`（全部 exit 0，耗时 334 s）。两臂通过硬链接共享这同一份构建产物：
- **PR 臂**：PR head。
- **base 臂**：merge-base `6b66321a5a`，即最后一次合进 head 的 main 提交。它是真实的 git worktree，与 PR 臂的唯一差异就是本 PR 改动的 5 个 `integration-tests/` 文件。

因此下面所有差异都只来自 harness 改动。两臂的 CLI 二进制逐字节相同。

| # | 检查项 | 结果 |
|---|---|---|
| 1 | head 上新增的见证测试 | ✅ 两个文件共 12/12 通过 |
| 2 | 变异矩阵：对两个 harness 和共享常量做 9 个变异，外加负向对照（两个 harness 都回退到 base） | ✅ 10/10 被杀，对照组为绿，文件按字节还原 |
| 3 | `satisfies Settings['memory']` 类型绑定（`tsc -p integration-tests`） | ✅ 键名拼错报 TS2561，值类型写错报 TS2322。对照：去掉 `satisfies` 后同样的拼写错误静默通过编译（exit 0） |
| 4 | 请求数：真实 `dist/cli.js` 对接假端点，base 与 PR harness 对比 | ✅ CLI 工具轮 3 → 2，CLI 纯文本轮 2 → 1，SDK 工具轮 3 → 2。被去掉的那一个请求是 `managed-auto-memory-extractor`，它也从 `stats.bySource` 中消失 |
| 5 | 抽取器是否在退出路径上？注入 1500 ms 延迟，每格交替运行 4 次 | ✅ 是。三条路径上 PR 都省下 1540–1600 ms，正好一次往返。base 中抽取器是最后一个请求，它返回后进程 25–58 ms 内退出 |
| 6 | 真实模型（CI 端点主机上的 `qwen3.8-max`，经记录代理），每臂交替 3 次 | ✅ base 每次 3 个请求（抽取器 4.4–6.3 s），PR 每次 2 个。墙钟时间中位数 11.5 s → 6.7 s，PR 的“约 5 秒”成立 |
| 7 | 回归差分：两臂全量跑整个 `integration-tests` 目录，清空所有凭据 | ✅ 唯一差异是 3 个新增见证测试（不存在 → 通过）。136 个失败在两臂是同一组，都是需要模型凭据或本机缺少的基础设施的用例 |
| 8 | no-AK 作业是否执行 SDK 见证测试？（R2-6） | ✅ 会执行：`./test-helper.test.ts` 是子串过滤。CI job 110149899515 运行了 `sdk-typescript/test-helper.test.ts (2 tests)`，本地同样如此 |
| 9 | 本 PR 是否修复 #13009？（R1-1） | ❌ 否：是一个 macOS 分片上的 DNS `ENOTFOUND` 故障。见发现 1 |

### 发现

**1. 合入前把 `Fixes #13009` 改为 `Refs #13009`（PR 元数据）。** 我是从原始 job 日志独立推出这个结论的，没有依赖 issue 讨论串。
- run 36541793897 中唯一失败的 job 是 macOS shard 1/2。
- 它的日志里有 154 处 `getaddrinfo ENOTFOUND llm-1yxl3y53fm8pcr4z.cn-beijing.maas.aliyuncs.com`。第一处在 08:40:10Z，分片启动 5 分钟后；最后一处在 10:09:34Z，分片结束时。
- 43 个失败测试中，21 个在断言里逐字引用了该错误。其余 22 个是同一时间窗内的真实模型 SDK 用例，以 `error_during_execution` 结束，或者没有发出预期的工具调用。
- 同一提交在 Linux none、Linux docker 和 macOS shard 2/2 上都通过了，抽取器在这些 job 里是完全开启的。
- 此后 main 的 `E2E Tests` 在不含本改动的情况下绿了 33 次，其中包括本 PR 的 merge-base `6b66321a5a`（run 36792479169）。

本 diff 不涉及域名解析，所以用 `Fixes` 会以一个并不存在的原因关闭 #13009。延迟方面的理由不依赖 #13009 也成立（第 5–6 行）。建议这样改：
- 在英文 “Linked Issues” 和中文 “关联 Issue” 两处都改用 `Refs #13009`。
- 把“失败的那次运行是第一个完整承担它的”那段改写成动机说明。

标题里的 `(#13009)` 后缀不会触发自动关闭。

**2. Risk & Scope 漏掉了一个覆盖面权衡（不阻断）。** 关闭 managed memory 去掉的不只是后台请求。每个主轮的系统提示里，整段 `# auto memory` 都会消失：87 行、6,172 字符，每个主请求真实 prompt 少约 2.9k tokens（42.1k → 39.2k）。工具列表不变（两臂都是 14 个工具）。结果是，本 PR 之后没有任何真实模型 E2E 的主轮再使用生产默认的系统提示。为了 E2E 稳定性，这大概是正确的取舍，但 PR 应该写明这一点。这也说明值得保留至少一个使用默认设置的真实模型冒烟测试，因为目前没有任何套件走重新开启的路径。

**3. R2-6 不成立。** SDK 见证测试在 PR 阶段确实会执行，因为 vitest 的文件过滤是子串匹配（CI 证据和本地复现见图 6）。可选的加固：把 `./sdk-typescript/test-helper.test.ts` 显式写进清单，让覆盖不依赖子串匹配。

**4. 已核查的延后评审项。**
- (a) `interactive/workflow-completion.test.ts` 里用户层的 `memory` 块：workspace 层优先级更高，使它变得多余。它设置的也是 `false`/`false`，所以行为不变，该套件在两臂都是 6/6 通过。
- (b) 新的默认值只覆盖 `TestRig` 和 `SDKTestHelper`。`cli/_daemon-harness.ts`、`qwen-live-harness.ts`、`helpers/hosted-harness-process.ts` 各自写 settings，启动时 managed memory 仍是开启的。适合作为后续改进，不阻断本 PR。
- (c) `SDKTestHelper` 在 `createQwenConfig: false` 时不写 settings 文件，因此拿不到默认值。目前没有套件使用这个选项。

### 截图

![假端点 A/B](./01-ab-fake-endpoint.png)
![见证测试与变异矩阵](./02-witness-mutation-typecheck.png)
![#13009 根因](./03-issue13009-dns.png)
![真实模型 A/B](./04-ab-real-model.png)
![回归差分](./05-regression-differential.png)
![no-AK 与请求面](./06-noak-lane-and-prompt-surface.png)

**未验证：** macOS、Windows、`sandbox:docker` 支路，以及 daemon、qwen-live、hosted 这几个 harness 的路径。

**测量说明：** 有一轮假端点测试我是两臂先后连续跑的，当时机器负载在 10 左右，PR 臂看起来反而慢了约 1.4 s。改为两臂交替运行、负载降到 2–4 后，这个差距完全消失，图 1 只用了交替运行的数据。如需复测，请交替运行两臂。

验证脚本、原始数据（JSONL/TSV）和 Markdown 版报告：this directory
