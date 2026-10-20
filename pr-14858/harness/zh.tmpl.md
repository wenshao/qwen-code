## 维护者验证：PR #14858，head `d4c44dc80b`

**结论：可以合入。** 我从源码分别构建了本 PR 的 head 和它的 merge-base，用同一个脚本化模型把两者在本 PR 涉及的所有界面上都跑了一遍。每个场景下，两个构建都在同一位置停止，退出码相同，实际执行的工具调用次数也相同；变化的只有说明文字。本 head 在每个界面上都能说对停止原因，Web Shell 的中英文界面都是如此。没有发现阻塞合入的问题。末尾有四条小提示，其中一条是 main 上已有的行为。

测试脚本、原始数据和原尺寸截图：[`wenshao/qwen-code@{SHORT}/pr-14858`]({TREE})

### 测试方法

- **两个构建。** 在 Linux x64 上用相同方式构建（`pnpm install --frozen-lockfile`、`npm run build`、`npm run bundle`）。**head** 是 `d4c44dc80b`；**base** 是 merge-base `ae126a0365`，main 在它之上只多一个无关提交。用 merge-base 而不是已发布版本作基线，对比中只有本 PR 的改动。
- **模型。** 一个零依赖的 OpenAI 兼容假模型，按场景编写脚本。它根据请求历史推算轮次，旁路请求不会推进场景。每次运行使用独立的 `HOME`。
- **覆盖的界面：**
  - headless `-p`，输出格式 `text`、`json`、`stream-json`
  - Ink TUI 和 OpenTUI 渲染器（bun），运行在 node-pty + xterm.js 下
  - 真实的 `qwen serve` daemon 及其内置 Web Shell，用无头 Chromium 驱动
  - daemon 经 SSE 发出的原始 `turn_error`
  - 写入本地文件的 OTEL `loop_detected`，headless 和 daemon 两侧都测

本轮是对这个 head 上前两轮验证的补充。[代码评审](https://github.com/QwenLM/qwen-code/pull/14858#pullrequestreview-5582361512)没有运行 CLI、TUI、daemon 的真实场景，并且有 480 个 core client 测试没能在本地跑完。这里完整跑了 `client.test.ts`（515 个通过），下面的每个场景也都是真实运行。相对作者的 E2E 报告，这是一套独立环境，在它之外还覆盖了 1000 次 backstop、两种仅 daemon 才有的原因、按提示改配置后重跑、新旧版本前后端交叉、daemon 重启后的冷加载，以及变异测试。

### 1. 停止位置不变，只有说明变了

| 场景（headless） | 退出码 · 轮数 · 发出的调用 · 实际执行（**base = head**） | head 上的 `loop_detected` |
| --- | --- | --- |
| 显式上限 3（`text`、`json`、`stream-json`） | 1 · 4 · 4 · 3 | `explicit_cap`，计数 4，上限 3 |
| “卡住”停止（每轮 10 个调用，其中一个重复） | 1 · 11 · 110 · 100 | `stuck_repetition`，101 / 100 |
| **backstop**（每轮 25 个互不相同的调用，无重复） | 1 · 41 · 1025 · 1000 | `backstop`，1001 / 1000 |
| 启发式重复（`skipLoopDetection: false`） | 1 · 6 · 18 · 15 | `repeated_call` |
| provider 重放（同一 id 和参数发 3 次） | 1 · 3 · 3 · 1 | 无（PR 已声明不在范围内） |
| 连续相同调用（对照） | 1 · 5 · 5 · 4 | `consecutive_identical_tool_calls`，无 reason，与 base 相同 |

daemon 侧，Web Shell 中七种原因在两个构建上显示的工具调用次数也相同：4、110、1025、18、3、3、12。

分类函数的替换是等价的。我从 base 产物导入旧的 `shouldHaltOnTurnToolCallCap`，从 head 产物导入新的 `getTurnToolCallCapHalt`，在 **897,780 组输入**上比对。输入覆盖 0 到 12,000 次调用、0 到 12 次键重复、含 ∞ 在内的 15 种上限，每种分别按显式和自适应各跑一遍。停止判定不一致的输入为 0；返回的原因和上限全部符合“显式 > backstop > 卡住”的优先级。

### 2. 新提示照做后确实有效

按 head 打印的每条提示改配置后重跑（这一部分 base 和 head 行为相同，只是 base 的文案不对）：

| head 上的提示 | 重跑配置 | 结果 |
| --- | --- | --- |
| 显式上限：“set it to 0 to disable the cap” | `maxToolCallsPerTurn: 0` | 跑满 20 轮，退出码 0 |
| 卡住：“an explicit `model.maxToolCallsPerTurn` replaces this repetition check” | `maxToolCallsPerTurn: 200` | 第 101 次不再触发卡住停止；在第 201 次以 `explicit_cap` 停止 |
| 卡住、backstop：“0 disables it” | `maxToolCallsPerTurn: 0` | 分别执行 300 次和 **1,500** 次，退出码 0 |
| 启发式重复：“Set `model.skipLoopDetection` to true to disable” | `skipLoopDetection: true` | 执行 60 次，未停止，退出码 0 |

最后一行证实了这次修正：base 的提示说这个检测器常开、不能通过 `model.skipLoopDetection` 关闭，这是错的。

![headless stderr，base 对比 head]({RAW}/img/headless-stderr-before-after.png)

### 3. daemon 的 `turn_error` 与遥测

原始 SSE `turn_error.data` 中，`loopType` 在两个构建上相同，只有 head 增加了新字段：

| 原因 | head 新增 |
| --- | --- |
| 显式上限 3 | `loopReason: explicit_cap`、`toolCallCount: 4`、`toolCallLimit: 3` |
| 卡住停止 | `stuck_repetition`、`110`、`100`（批次在执行前计数，与遥测文档一致） |
| backstop | `backstop`、`1025`、`1000` |
| 启发式重复 / provider 重放 | `repeated_call` / `provider_duplicate_id` |
| 无效参数 / 重复失败 | 无新增；这两种类型按设计不带 reason |

daemon 的 OTEL `loop_detected` 与之一致：`explicit_cap` 4/3，以及 `provider_duplicate_id`。

### 4. Web Shell（真实 daemon，无头 Chromium）

base 上七种 daemon 原因都显示同一句通用文案。head 上每种原因都显示各自的文案，实时输入、刷新页面之后以及 zh-CN 界面下都是如此。重复失败场景使用了 `QWEN_CODE_ACP_REPEATED_TOOL_FAILURE_GUARD=enforce`，因为该守卫默认运行在 shadow 模式。

![Web Shell 显式上限（中文）]({RAW}/img/ws-explicit-zh-CN.png)
![Web Shell 卡住停止（中文）]({RAW}/img/ws-stuck-zh-CN.png)
![Web Shell backstop（中文）]({RAW}/img/ws-backstop-zh-CN.png)

<details>
<summary>其他原因的中文截图</summary>

![启发式重复]({RAW}/img/ws-repeated-zh-CN.png)
![provider 重放]({RAW}/img/ws-replay-zh-CN.png)
![无效参数]({RAW}/img/ws-invalid-zh-CN.png)
![重复失败]({RAW}/img/ws-failing-zh-CN.png)

</details>

**新旧前后端交叉，两个方向都正常。** 我替换了 daemon 提供的 `dist/web-shell`，并通过实际返回的 `index-<hash>.js` 确认替换生效。head 前端连 base daemon，以及 base 前端连 head daemon，都显示通用文案，且都没有报错。

### 5. TUI 与 OpenTUI

head 上，我测的四种原因在循环对话框中都显示 `Cause: …`，按 Esc 之后的消息与 headless 文案一致。base 只有通用句。OpenTUI 也打印了按原因区分的消息（测了显式上限）。截图见英文部分。

### 6. 测试

- **head 上本 PR 涉及文件的单元测试：**

  | 包 | 文件数 | 用例 |
  | --- | --- | --- |
  | core | 2（`loopDetectionService`、完整的 `client.test.ts`） | 681 通过（166 + 515） |
  | cli | 6 | 1,831 通过，1 跳过 |
  | acp-bridge | 1 | 1,021 通过 |
  | SDK | 1 | 429 通过 |
  | Web Shell | 2 | 286 通过 |

- **本 head 的 CI：** Test、Lint & Static、Integration（no-AK）、web-shell E2E smoke、TUI parity 和 OpenTUI no-flicker 门禁均为绿色。
- **导出渲染脚本：** base 为 2,041,619 字节，head 为 2,046,758 字节，增加 5,139，与 PR 所述一致。旧上限 2,045,000 会超限；新上限下还剩 3,242 字节。
- **变异测试：** 对 14 个含逻辑的改动生产文件施加 25 个定向变异，每个变异用 PR 中对应文件自带的测试运行。**{KILLED} 个被测试发现，{SURVIVED} 个存活。** 两个存活的变异见下面第 1 条。

### 提示（均不阻塞）

1. **两处小的测试缺口。** 25 个变异中有 2 个存活。上面的真实运行表明，这两处的现有代码都是正确的。
   - `packages/core/src/telemetry/qwen-logger/qwen-logger.ts`：删掉 RUM 中 `loop_reason` 那段展开后，`qwen-logger.test.ts` 和 `loggers.test.ts` 仍然全部通过。
   - `packages/cli/src/acp-integration/session/Session.ts`：把 daemon 的 `toolCallLimit` 从 `capHalt.limit` 改成 `config.getMaxToolCallsPerTurn()`（100）后，`Session.test.ts` 仍然全部通过。这样 backstop 停止时 Web Shell 会显示“100 次的安全上限”。core 中的同类变异能被测试发现；daemon 侧没有 backstop 测试。

   各补一条断言即可固定住。
2. **OpenTUI 原样显示反引号。** 共享文案用反引号标记设置名。Ink 会把它渲染成行内代码，对话框会把它改写成引号，但 OpenTUI 原样打印：``Raise `model.maxToolCallsPerTurn`, or set it to 0…``（见 OpenTUI 截图）。`event-adapter.ts` 可以复用对话框里的改写。
3. **渲染脚本预算，仅供参考。** 新上限下只剩 3,242 字节，下一次新增 i18n 文案大概率还要再调。
4. **main 上已有的行为，不是本 PR 引入的。** daemon 重启后，被循环保护停止的那一轮在两个构建上都不再显示任何停止说明，只剩 “The previous request was interrupted before the response completed. [Continue execution]”（截图见英文部分）。这条横幅在实时会话中停止后立即出现，刷新后依然存在，两个构建都一样。两个构建上的对照运行（一次普通轮次、一次正常结束的 20 轮工具调用）都没有这条横幅，说明它来自循环停止。于是界面会邀请用户“继续执行”一轮被有意停止的操作。设计文档把“刷新后保留”的说法限定在实时会话，这一点成立。或许值得后续跟进。

另外确认了 PR 已声明的一项限制：遇到 provider 重放时，TUI 对话框仍然提供“本会话禁用循环检测”选项。
