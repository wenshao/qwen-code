## 本地真实环境验证（第 2 轮）—— PR #11727 @ `c2d3c24df8`

**结论：第 3 轮评审提出的 Critical 已修复，原修复依然有效。行为层面可以合并，前提是清掉两个 `CHANGES_REQUESTED` 评审。**

- 我在真实 CLI 上用 `8ac6e4d602` 时的代码复现了 qqqys 提出的 Critical：**148,846 字符的原始输出被完整送进了模型**。到了 `aee22dfbfd`，同样的运行被限制在 1,151 字符。
- #11729 描述的默认配置区间问题仍然保持修复，所有对照场景送达的长度都与 merge base 相同。
- 预留机制带来一个新的、范围很窄的副作用，见第 3 节，附带一行修复，已在真实 CLI 上验证。不阻断合并。

上一轮（`e0e63c60e5`）：https://github.com/QwenLM/qwen-code/pull/11727#issuecomment-5650385612

### 测试方式

- **构建：** 两个 worktree，各自独立执行 `npm ci` 并构建：PR head `c2d3c24df8`，以及 merge base `ee1ebcc167`。`git diff ee1ebcc167 c2d3c24df8` 恰好是本 PR 的 8 个文件（+961/−31）。
- **CLI：** 真实的 `qwen` CLI，headless（`-p --approval-mode yolo`）与 tmux 中的交互式两种方式都跑。
- **Mock 模型：** 一个 mock OpenAI 端点下发一次 `run_shell_command` 调用，并**原样保存发给模型的 tool 消息**。随后它用一行摘要描述这条消息作为回复，所以 TUI 里也能看到同样的判定。
- **第三组 NOCLAMP：** 在 head 构建的 `shell.js` 编译产物里去掉 `Math.max(1, …)`，与 qqqys 评审时的代码一致：
  - `git diff 8ac6e4d602 aee22dfbfd -- packages/core/src/tools/shell.ts` 恰好只有这一处 clamp。
  - 两个提交之间合入的 `main` 没有改动 `shell.ts`、`coreToolScheduler.ts`、`tools.ts`、`truncation.ts` 中的任何一个。
  - 每次运行时打补丁、运行后还原，每批结束后都检查了还原结果。
- **命令：** 真实 bash，先输出 N 行定宽文本，再输出一行 `TAIL-STATUS: …`，最后 `exit N`。
  - "慢"命令会等待超过单次调用 6 秒超时的一半，从而触发长任务提示。
  - "超时"命令在 4 秒超时下阻塞在 `tail -f /dev/null`。
- **环境：** Linux x64，Node 22.22.2。关键行重跑了一轮（r2），结果与 r1 完全一致。

### 1. 区间修复在 head 上依然成立

![real CLI A/B](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/01-real-cli-ab.png)

- **区间内的场景（s1 成功、s2 失败、s5 超时）：** base 给模型的是约 2.5k、只保留头部的存根；head 送达完整正文，包括尾行和退出码。超时本来就没有退出码。
- **与第 1 轮相比的行为变化（符合设计）：** 在 637 字符的长任务提示区间里（s7、s8），`e0e63c60e5` 会完整送达约 30.3k。
  - head 现在会在工具内部截断成 Shell 自己约 5.1k 的头尾预览。正是 R1-2 引入的预留让带标记的字符串落在 30k 预算之内。
  - 尾行、退出码和提示都照常送达。
  - 能放进预留之后预算的正文（s7b）仍然完整送达：29,320 字符。
- **对照组，两组完全一致：** 小输出、低于门槛的输出、远超预算的输出、远超预算的超时，以及显式配置 `truncateToolOutputThreshold: 25000`。

同一个 s2 场景在交互式 TUI 中的表现：base（上）是只保留头部的 `<persisted-output>` 存根；head（下）是完整结果，结尾是 `Exit Code: 3`。

![TUI s2](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/tui-s2-base-vs-head.png)

### 2. 第 3 轮 Critical：在 `8ac6e4d602` 上真实存在，已由 `aee22dfbfd` 修复

![critical A/B/C](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/02-critical-abc.png)

- **c1**（`truncateToolOutputThreshold: 100`，慢命令，`exit 3`）：
  - NOCLAMP 送达 **148,846 字符，也就是全部原始输出**。
  - head 送达 1,151 字符，base 送达 1,251 字符。
  - 交互式 TUI 结果相同：NOCLAMP 148,846，head 1,137。
- **只有失败路径是无上界的：**
  - 成功路径（c2）在三组中都有上界。
  - 快速失败（c3）同样有上界：不触发提示，也就没有预留。
- **测试：** 新增的回归测试 `keeps a sub-advisory explicit threshold from disarming the pass it marks` 能抓住 NOCLAMP 的代码（第 4 节中的变异体 M1）。

![TUI c1](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/tui-c1-8ac6-vs-head.png)

### 3. 新发现：阈值显式设得很小时，预留会把预览挤空（不阻断）

![threshold sweep](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/03-threshold-sweep.png)

**原因。** clamp 保证了正文有上界，但 `bodyBudgetChars = Math.max(1, outputThreshold - appendedMetadataChars)` 仍可能把整个预算都花在 637 字符的提示预留上。

- `previewChars` 等于 `Math.min(4000, bodyBudgetChars)`，所以阈值为 600 时预览**只剩 1 个字符**。
- 模型只收到截断说明头和提示，看不到命令、看不到输出行，也看不到退出码。
- 同样配置下，base 送达的是头尾预览，其中包含 `Exit Code: 3`。

**扫描结果**（慢命令，`exit 3`）：

| 显式阈值 | base | head |
| --- | --- | --- |
| 300、600、700 | 尾行 ✓ · 退出码 ✓ | 尾行 ✗ · 退出码 ✗ |
| 800 | 尾行 ✓ · 退出码 ✓ | 尾行 ✗ · 退出码 ✓ |
| 1,000 及以上 | 尾行 ✓ · 退出码 ✓ | 尾行 ✓ · 退出码 ✓ |

- 用快速命令在 T = 600 和 T = 1,000 做的对照，两组结果完全一致，由此确定原因就是预留。
- 在这么小的阈值下，预留本来也达不到目的：光截断说明头就有约 510 字符，所以无论如何 head 在 600 字符的阈值下都会送达 1,151 字符。

![model view c4](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/05-model-view-c4.png)

在 TUI 里，`Truncated part of the output:` 后面什么都没有：

![TUI c4](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/tui-c4-base-vs-head.png)

**影响范围。** 需要同时满足两个条件：`truncateToolOutputThreshold` 显式设为约 1k 以下，并且前台命令运行时间达到超时的一半以上。默认配置不受影响。

但它丢掉的恰恰是本 PR 要保住的退出码。新增的回归测试之所以通过，是因为它只断言三件事：有截断标记、原始正文不在结果里、记录了落盘文件。

**候选修复（已验证）。** 只改 `shell.ts` 的一行，也就是 clamp 那一行：预留最多占阈值的一半。

```ts
const bodyBudgetChars = Math.max(
  1,
  outputThreshold -
    Math.min(appendedMetadataChars, Math.floor(outputThreshold / 2)),
);
```

![candidate fix](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/06-candidate-fix.png)

应用该改动后，真实 CLI 上的结果：

- **T = 600：** 尾行 ✓，并保留 `Exit Code: 3`。
- **T = 800：** 尾行 ✓，退出码 ✓。
- **T = 300：** 退出码 ✓，尾行 ✗。
- **T = 100（Critical 场景）：** 仍然有上界，1,184 字符。
- **默认配置下的场景，保持不变：** s2 完整 28,693，s7b 完整 29,320，s7 头尾预览 5,141。
- **测试：** `shell.test.ts` + `coreToolScheduler.test.ts` 仍为 756/756 通过。

另外建议让回归测试在阈值约 600 时断言 `Exit Code:` 仍然保留。

### 4. 测试

![tests and mutants](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/04-tests-mutants.png)

- **Head：** **756 通过**。
- **反事实验证**（用 PR 的测试文件跑 merge-base 的生产代码）：**恰好 11 条新增正向测试失败**。
- **针对生产代码改动的变异测试：13 个变异体杀死 11 个。**
  - 第 1 轮存活的三个变异体现在都被杀死了：`errorBodyAlreadyBounded` 里的标记检查（M7）、超时调用点（M9–M11）、120 字符上限（M4）。
  - M12（超时 else 分支忽略标记）存活，但目前与原代码等价：只有 Shell 会打标记，而 Shell 总会声明 `maxOutputChars`。
  - **M13 存活，证实了 R3-2：** 从预留里删掉 `attributionWarning` 那一项，两个测试套件依然全绿。

### 5. 残留问题与未处理的评审项

- **失败 hook 仍会让门槛重新生效**（第 1 轮后续建议第 2 条，未变）。
  - s2 加一个 `PostToolUseFailure` hook，两组都是 2,498 字符、只保留头部的存根。hook 文本和 `Exit Code: 3` 只存在于落盘文件中。
  - 这是设计取舍，不是回归。
- **R3-4 是文档准确性问题，不是回归。**
  - 超时路径上，失败 hook 的上下文追加之后没有合并检查。
  - hook 返回 50k 的 `additionalContext` 时，base 已经会送达 52,460 字符；head 送达 78,657 字符，因为 hook 文本前面现在是完整正文。
  - 两者都只受聚合批次预算约束。设计文档的第 5 条不变量仍声称这条路径上有合并检查。
- **第 3 轮仍未处理的项**（都是 Suggestion，作者尚未回复）：
  - **R1-1：** 超时路径的重新定界把成功路径的定界策略内联复制了一份。
  - **R3-1：** `2026-08-10-tool-output-offload-preview.md:56` 仍把 "aborts" 列为不带标记的路径。实际上超时的 s5 正文带标记，这也正是它现在能完整送达的原因。
  - **R3-2：** 已由上面的 M13 证实。
  - **R3-3：** 该设计文档仍没有 `.zh-CN.md` 版本。
  - **R3-5：** 本轮未复查。
- **第 1 轮以来已修复：** 后续建议第 3 条（`tools.ts` 的注释）。

### 合并检查清单

- **`c2d3c24df8` 上的 CI：** 所有必需检查都已通过；`review-pr` 仍在运行。
- **评审状态：** `reviewDecision` 为 `CHANGES_REQUESTED`，分别来自 qqqys 和评审机器人，都针对 `8ac6e4d602`。两者针对的都是第 2 节已证实修复的 Critical，需要重新评审或 dismiss。
- **建议：** 合并前顺手带上第 3 节那一行 half-cap 修复，或者作为后续跟进单独记录。除此之外没有阻断项。

### 本次未覆盖

- 只在 Linux 上测试，没有跑 macOS 和 Windows。
- 没有在真实 CLI 上触发预留中归因告警那一半：它需要一次 `git commit`，并且 attribution note 写入失败。这部分只有 M13 的结果作为依据。
- 派生失败和启动失败无法通过真实 CLI 触发，与第 1 轮一样只有单元对照测试覆盖。

图表、harness 脚本和每次运行的原始摘要：https://github.com/wenshao/qwen-code/tree/asserts/pr-11727
