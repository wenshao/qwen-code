## 本地真实环境验证（第 3 轮）—— PR #11727 @ `fd61c750b0`

**结论：建议合并。**

- 前两轮的两个发现都已修复，并在真实 CLI 上验证过。
- 没有发现回归。
- 第 3 轮评审提出的建议都已处理。
- 只剩一个流程问题：两个 `CHANGES_REQUESTED` 评审（qqqys 和评审机器人，都针对 `8ac6e4d602`）针对的是已修复的 Critical，需要重新评审或 dismiss。

前几轮：
- 第 1 轮 @ `e0e63c60e5`：https://github.com/QwenLM/qwen-code/pull/11727#issuecomment-5650385612
- 第 2 轮 @ `c2d3c24df8`：https://github.com/QwenLM/qwen-code/pull/11727#issuecomment-5652717655

### 与第 2 轮相比的改动

- **`88f37ebe5d`**，重构、文档与测试：
  - 三态映射抽成了一个共享辅助函数 `persistedOutputFilesForTruncation`（R1-1）。
  - 预留量和追加现在都来自同一个 `appendedMetadata` 列表加 `APPENDED_METADATA_SEPARATOR`（R3-2）。
  - 修复 R3-1、R3-3、R3-4、R3-5 指出的文档问题。
  - 新增两条测试。
- **`fd61c750b0`**：第 2 轮第 3 节提出的 half-cap，与我当时验证的候选修复完全一致，并附回归测试 `keeps the exit-code line when the reservation would eat a sub-advisory threshold`。
- **`28e730cf8b`** 是分支合入自身的 merge。merge base 仍是 `ee1ebcc167`，`git diff ee1ebcc167 fd61c750b0` 只涉及本 PR 自己的 9 个文件（+1390/−82）。

### 测试方式

- **测试工具：** 与第 2 轮相同。
  - 真实 `qwen` CLI，headless 和 tmux 交互式都跑。
  - mock OpenAI 端点原样保存发给模型的 tool 消息。
  - 真实 bash 命令：输出指定大小的内容，加一行 `TAIL-STATUS: …`，最后 `exit N`。
- **构建：** head 在 `fd61c750b0` 重新构建。base 构建不变（merge base 相同），但本轮所有 base 场景都重跑了一遍。
- **变异组**，在同一个 head 构建里打补丁，每次运行后还原：
  - **NOHALFCAP**：从 `shell.js` 编译产物里去掉 half-cap，复现 `c2d3c24df8` 的预留行为。
  - **NOCLAMP**：clamp 和 half-cap 都去掉，复现 `8ac6e4d602`。
- **环境：** Linux x64，Node 22.22.2。

### 1. 前两轮的两个发现都已修复

![critical](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/round3/02-critical.png)

- **第 2 轮的 Critical**（c1：`truncateToolOutputThreshold: 100`、长时间运行、`exit 3`）：
  - NOCLAMP 仍会**完整送达 148,846 字符的输出**，说明这个变异组确实生效。
  - head 送达 1,199 字符，有上界。
- **第 2 轮第 3 节的空预览问题**（c4，阈值 600）：
  - NOHALFCAP 复现了第 2 轮：1,156 字符，尾行和退出码都没有。
  - head 送达 1,450 字符，**包含 `TAIL-STATUS` 和 `Exit Code: 3`**，与 base 一样。

![threshold sweep](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/round3/03-threshold-sweep.png)

**阈值扫描。**
- 从 T = 600 开始，head 每一行都与 base 一样保留尾行和退出码。
- T = 300 时，head 保留退出码、丢了尾行：此时正文预算只有 150 字符，预览放不下两者。
- 快速命令的对照组两边完全一致。
- 本构建中 NOHALFCAP 的判定与第 2 轮在 `c2d3c24df8` 上测到的一致：T = 300 两者都没有，T = 600 两者都没有，T = 800 只有退出码。长度只因落盘文件路径不同差几个字符。说明变化完全来自 half-cap 这一行。

交互式 TUI 中（上为 NOHALFCAP，下为 head），`Truncated part of the output:` 后面不再是空的：

![TUI c4](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/round3/tui-c4-nohalfcap-vs-head.png)

### 2. 区间修复与对照组保持不变

![real CLI A/B](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/round3/01-real-cli-ab.png)

每一行都与第 2 轮数值相同：
- s1 完整 28,679；s2 完整 28,693，退出码 3；s5 超时完整 28,655。
- s7b 完整 29,320；s7/s8 为 Shell 头尾预览，约 5.1k。
- 小输出、低于门槛、远超预算、显式 25000 这几组对照与 base 一致。

因此 `88f37ebe5d` 的重构在真实 CLI 上没有改变行为。关键场景重跑了一次，结果一致。

### 3. `88f37ebe5d` 重构审查

- **三态辅助函数：** 三个调用点（成功、合并检查、超时）语义不变。两个非平凡分支都有测试钉住：把 `[file]` 改成 `[]`（M11）、把 `[]` 改成 `undefined`（M11b），各自都会让测试失败。
- **合并后的追加循环：** 归因告警在 TUI 显示上的追加，被挪进了 `typeof llmContent === 'string'` 判断内。
  - `execute()` 里 `llmContent` 始终是字符串：初值为 `''`，格式化正文是 `[…].join('\n')`。所以目前行为不变。
  - 循环上方的注释已经写明了 `Part[]` 的情况。
- **判空方式：** `.filter((s) => s !== null)` 取代了原来的真值判断。提示和告警都不可能是空字符串，两者等价。
- **文档：**
  - half-cap 的理由在中英文里都写上了。
  - 新增的 `2026-08-10-tool-output-offload-preview.zh-CN.md` 与英文版标题结构一致（7/7），并互相链接。
  - 第 5 条不变量已限定合并检查只在成功路径上生效。
  - 非目标中列出的预算与源码一致：agent 32,000；web-search 100,000 + 2,000；MCP 500,000。

### 4. 测试

![tests and mutants](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/round3/04-tests-mutants.png)

- **Head：** **759 通过**。
- **反事实验证**（用 PR 的测试文件跑 merge-base 的生产代码）：**13 条依赖修复的测试失败**，即第 2 轮的 11 条加上两条新的预留测试。
- **变异测试：17 个杀死 14 个。**
  - M1（≈ `8ac6e4d602`）和 M1b（≈ `c2d3c24df8`）都被杀死，说明前两轮的两个发现现在都有测试能抓住。
  - 第 2 轮存活的 M13（预留中漏掉 `attributionWarning`）现在被 `reserves the appended attribution warning out of the body budget` 杀死。
  - M1c 存活，但与原代码等价：有了 half-cap 之后，任何 `T ≥ 1` 都满足 `T − min(r, ⌊T/2⌋) ≥ 1`，clamp 不会再触发。多留一层防御，无害。
  - M12 存活，目前也与原代码等价：只有 Shell 会打标记，而 Shell 总会声明预算。
  - M2b 存活。预留计算中去掉 2 字符分隔符没有测试钉住，最多偏差 4 字符。可选，价值不高。

### 5. 残留问题（不阻断）

- **失败 hook 仍会让门槛重新生效：** s2 加一个 `PostToolUseFailure` hook，两组都是 2,498 字符的存根。autofix 已把这个设计问题记入后续队列。
- **超时路径上的 hook 上下文只受聚合批次预算约束：** hook 返回 50k 的 `additionalContext` 时，base 为 52,460，head 为 78,657。这个问题在本 PR 之前就存在，现已写进第 5 条不变量。

### 合并检查清单

- **`fd61c750b0` 上的 CI：** 所有必需检查都已通过（Test、Lint & Static、Integration no-AK、web-shell E2E、Desktop Shell）；`review-pr` 仍在运行。
- **评审状态：** `reviewDecision` 为 `CHANGES_REQUESTED`，分别来自 qqqys 和评审机器人，都针对 `8ac6e4d602`。两者针对的都是第 1 节已证实修复的 Critical，需要重新评审或 dismiss。
- **建议：** 合并。

### 本次未覆盖

- 只在 Linux 上测试。
- 没有在真实 CLI 上触发预留中归因告警那一半：它需要一次 `git commit`，并且 attribution note 写入失败。现在已有能杀死 M13 的单元测试钉住它。
- 派生失败和启动失败：与前几轮一样，只有单元对照测试。

图表、测试工具和每次运行的原始摘要：https://github.com/wenshao/qwen-code/tree/asserts/pr-11727/round3
