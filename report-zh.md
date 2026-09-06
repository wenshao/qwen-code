# 维护者验证 —— 搭建真实环境端到端跑通

在一台 Linux 机器上，以打包后的 CLI（`npm ci && npm run bundle`）和真实 OpenAI 兼容端点，验证 head `4fa8cdf0d8` 对比 merge-base `1b604721b0`：`QWEN_SANDBOX=false QWEN_E2E_RENDERER=ink VERBOSE=true KEEP_OUTPUT=true`。

**结论：建议合并，但需先做两处修改 ——（1）重写 PR 描述，它在当前 head 上与 diff 实质不符；（2）把种子等待预算从 60 秒提高到约 90 秒。** 两者都不是代码缺陷。本 PR 的两个部分所针对的失败，我都**证实**了（而非推断），并且第二部分修的正是 CI 重试救不回来的那一个。

---

## 1. 前提现在是被证实的，不是推断出来的

autofix 循环之所以要用 vitest 的 sha1 分片 sequencer 反推失败套件，是因为 `GET /actions/jobs/…/logs` 返回 **HTTP 403 `Must have admin rights to Repository`**。我有该权限，于是拉取了运行 [33954230547](https://github.com/QwenLM/qwen-code/actions/runs/33954230547) 的两份 job 日志（16 MB 与 11 MB）并逐一阅读。

**两个被点名的原因都逐字出现在日志里。两条腿的反推都是对的。**

**Linux，job `101275136893`，sandbox:none shard 2/3** —— `Test Files 1 failed | 23 passed | 1 skipped`，唯一的失败是 `interactive/context-compress-interactive.test.ts` 的两个真实模型用例，都停在 `AssertionError: chat_compression telemetry event was not found`，都在 `90000` 的调用点上（改动前文件的第 63 行与第 155 行）。这正是本 PR 放宽的那条断言。

**macOS，job `101275136939`，shard 1/2** —— 是**另一个**失败，也正是第 2 轮提交 `45b404eb77` 处理的那个：`qwen-live-m4-acp-steering.test.ts` → `Error: qwen-live exited with 1 before listening: stderr=… ERROR acp backend 'qwen-acp' did not initialize`。注意它上方两行：/compress 套件在这条腿上同样在抖，只是靠 `(retry x1)` 才活下来，**每个用例 234 秒**。

## 2. Linux 失败的解剖

按时间戳从原始日志还原：六次尝试（2 个真实用例 × `retry: 2`）无一例外走的是同一条路 —— 25 秒的种子等待超时（`Poll timed out after ~122 attempts`，helper 的轮询周期为 200 ms），`einstein` 哨兵在**其后 9–25 秒**才出现，于是 `/compress` 是在回合中被输入的；随后 `Compressing chat history` 转了 **65.6–81.4 秒**，而在 90 秒轮询放弃时**仍在转**。整份 16 MB 日志里从未出现 `Chat history compressed`。

也就是说，本 PR 放宽的两个预算，恰恰就是真正耗尽的那两个。PR 的因果叙述成立。

## 3. 对生产代码改动做故障注入

第 2 轮提交把 `packages/qwen-live/src/adaptor/acp-adaptor.ts` 中的 `INIT_TIMEOUT_MS` 从 10 秒提高到 30 秒。我在 ACP 子进程启动处注入延迟，让 `initialize` 握手超出预算，然后运行真实套件：

- `10_000` + 12 秒延迟 → **逐字复现** macOS 的 CI 失败：同样的包装错误、同样的适配器信息、同样两个用例被报为 skipped。
- `30_000` + 12 秒延迟 → 通过（13199 ms）。
- `30_000` + 29 秒延迟 → 通过（30201 ms）。

由此得到三点，其中一点与一条未解决的评审意见相反：

- **评审发现 R5-1 不成立。** 它认为适配器自身的 `did not initialize` 永远不可能是被观察到的失败，因为 harness 的启动预算把它包住了。实际上是 `registry.preflight()` **被 reject**，`LiveDaemon.start()` 向上传播，守护进程以 1 退出，`qwen-live-harness.ts:230` 的 `onExit` 在**任何启动计时器触发之前**就把适配器的信息报了出来。29 秒那一组也说明 harness 的 30 秒启动预算并没有吃掉放宽出来的区间。
- **`retry: 2` 救不了这一个。** ACP 栈在 `beforeAll` 里启动，所以套件直接失败（它的两个用例显示为 `↓` skipped）。这正是为什么 macOS 那条腿变红、而 /compress 的抖动被重试救回 —— qwen-live 这一半才是更硬的失败。
- 这一半在本 PR 上**是有闸门的**：`qwen-live-m4-acp-*` 属于 `test:integration:no-ak:sandbox:none`，该检查为绿。我也在 PR head 上本地跑了两个 ACP 套件：4/4 通过。

## 4. 针对真实模型的本地 A/B

|  | 文件 | test 1 | test 3 | 重试 | 超时的等待 |
| --- | --- | --- | --- | --- | --- |
| base `1b604721b0` | 83974 ms | 29525 ms | 54448 ms | 无 | 25 秒种子等待 ×1 |
| PR `4fa8cdf0d8` | 122836 ms | 26336 ms | 96499 ms `(retry x1)` | 1 | 60 秒种子等待 ×1 |

两条腿都通过；差别在于"慢种子回合"在哪里暴露出来。base 上 25 秒等待**静默**超时，`/compress` 于是在回合中被输入 —— 这正是本地复现出来的 CI 症状。PR 上 60 秒等待超时后会**大声地让该次尝试失败**，并附上终端尾部内容。方向是对的，问题出在取值 —— 见发现 2。

遥测对比也一并确认了 settings 那一半：在 `KEEP_OUTPUT=true` 下，`interactive-compress-test/telemetry.log` 在 base 上带有 `memory.recall`、`memory.recall.delivery`、`memory.extract` 和 `subagent_execution ×2`，在 PR 上**一个都没有**。这个新键是一个真正生效的开关，不是空开关。

---

# 发现

### 1 · 阻塞合并记录 —— PR 描述在当前 head 上实质失真

它仍然写着 *"Test-only; no production code"*、*"the diff touches one integration suite and no package source"*，以及 *"Also deliberately untouched: the 25-second wait for the seeded response"*。而在 `4fa8cdf0d8` 上，diff 是 **5 个文件、+185 −29**，其中包含 `packages/qwen-live/src/adaptor/acp-adaptor.ts` 里的一个**生产**默认值，并且种子等待已经变成 60 秒**且被断言**。Evidence 表格与每次尝试的风险算术也因同样原因过期。`Fixes #11088` 指向的还是一个以 *not planned* 关闭的 issue。

PR 描述是最终进入合并记录的东西，而它目前告诉审阅者的与 diff 的实际行为相反。这是我唯一会卡住合并的一点。（评审机器人的 R4-3 / R5 线程是对的，此处予以确认。）

### 2 · 新的 60 秒种子预算低于 PR 自己引用的那次运行中最慢的种子回合

在运行 33954230547 中可观察到十次种子回合，耗时分别为 **32、34、36、36、38、39、40、40、50、64 秒**。其中 64 秒那一次（macOS 腿）超出了新预算 —— 在本 PR 下，那次尝试会在新的硬断言 `expect(seeded…)` 上失败，而不是继续往下走。我在本地 11 次种子等待中也有 4 次撞上同样的超时。

建议改为 **90 秒**。对 300 秒 `testTimeout` 的算术：15 秒就绪 + 90 秒种子 + 150 秒事件 = 255 秒，余量 45 秒，相对最慢观测值有 1.4 倍裕度。在健康的运行上这不花任何代价，因为哨兵一出现等待就返回 —— 它只改变"真正卡住的种子回合"多久才失败。

### 3 · 新的 token 缩减断言只在种子断言守得住时才安全

十次真实的 `chat_compression` 事件，做了插桩以避免任何一次尝试被 `retry: 2` 掩盖。种子完成的 **7** 次全部通过，缩减 7–9 %。种子等待超时的 3 次里有 **2** 次失败 —— 其中样本 #10 是一次真实的 base 套件运行（`tokens_before=29365, tokens_after=30107`，`cache_sharing_used:false`），它在 `main` 上**是通过的**，在本 PR 下会变红。

机制是清楚的，也不是代码 bug：回合中触发的 `/compress` 对一段被截断的历史做摘要（`compression_input_token_count` 为 2462，而种子完成时是 30154），`chatCompressionService.ts:1140` 的估算器随即报告膨胀。另外注意：该服务把 `newTokenCount === originalTokenCount` 视为 `COMPRESSED`，而新断言要求严格的 `>`。

所以这条断言是站得住的，并且修好发现 2 基本就化解了它 —— 但它确实把一个依赖模型的数值变成了"本 PR 意在去抖动的那个套件"的通过/失败条件。值得在代码注释里加一句说明这种耦合。

### 4 · 小问题 —— 两个新测试都没有钉住它们各自针对的常量

`INIT_TIMEOUT_MS` 取 21 000 / 25 000 / 29 000 时都是 14/14 全绿；只有 10 000 和 120 000 会被抓到，因此这两个测试钉住的是开区间 (20 s, 30 s]，而不是 `30_000`。另外，把 `readTelemetryEvent` 里的 `event.name` 过滤整段删掉，9/9 仍然全绿 —— fixture 的最后一行本身就是一条 `chat_compression`，`pop()` 照样返回正确记录，于是这个 helper 存在的唯一契约反而没有被测到。两点都印证了已有的评审线程（R5-3、R5-4）。严重性低：两处的**行为**变化都被钉住了，只是具体取值没有。

### 5 · 已确认 —— 本 PR 上没有任何闸门运行它所去抖动的套件

`Integration Tests (CLI, No Sandbox)` 是 `SKIPPED`；`no-AK` 列表不含 `interactive/`。因此 /compress 的这些耗时数据在 CI 上是未经验证就要合入的（本评论即为其替代）。qwen-live 那一半和 `test-helper.test.ts` **在**该列表中且为绿 —— 值得记一笔，因为那正是带生产代码的一半。

---

## 我没有验证到的部分

- **macOS。** 此处没有 macOS runner。上面的 ACP 复现是在 Linux 上做的；该改动没有平台分支，而它修复的失败是在 macOS 上观察到的。
- **150 秒对 CI 硬件是否够用。** 我的端点不是 CI 的端点，本地我见到 150 秒轮询超时两次 —— 但两次都发生在一个已经超出自身预算的种子回合之后，也就是发现 2 所说的那个状态。在参考运行里，压缩在 65–81 秒时仍在进行，且当时抽取器在与之竞争；因此"关掉抽取器 + 150 秒"是一个合理的下注，而非已证明的结论。
- **失败的 macOS runner 上握手的确切耗时。** 日志记录的是那次 reject，而不是子进程实际花了多久。

---

## 环境

工作树分别位于 `pr11094-head`（`4fa8cdf0d8`）与其 merge-base（`1b604721b0`）；在 head 工作树里执行 `npm ci` + `npm run bundle`；A/B 只替换套件文件本身，因为 `packages/qwen-live` 不在交互式套件所驱动的 CLI bundle 里。模型：通过 `security.auth.selectedType: openai` 接入的真实 OpenAI 兼容端点。ACP 注入把后端的 `command`/`args` 换成一个先 sleep 再 `exec` 真实子进程的 shim，因此只有握手被延迟。
