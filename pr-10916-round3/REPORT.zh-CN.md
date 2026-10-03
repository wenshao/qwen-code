## 维护者验证，第 3 轮（仅增量）@ `72f3d0ae04`

第 2 轮是 `3fb6a1f042` 上的 [5963467302](https://github.com/QwenLM/qwen-code/pull/10916#issuecomment-5963467302)。此后 head 只多了一个提交 `72f3d0ae04`，它套用了第 2 轮的 R7-1 补丁：增删行与 [`fix-r7-1-agent-history.patch`](https://github.com/wenshao/qwen-code/blob/5ece30944b947d102bbbf1a0a0801bbcf745f260/pr-10916-round2/harness/fix-r7-1-agent-history.patch) 逐字节一致。本轮在全新构建上验证这个提交，并重跑第 2 轮已关闭的各项。

**结论：R7-1 已修复，没有引入回归。合入前还差一件事：对第 2 项（headless 误停）做出裁定。**
- **已修复，并在真实会话中验证：** R7-1，带负对照。
- **在新 head 上仍保持修复：** R6-1、R11-1、R11-2。
- **需要裁定：** 第 2 项。新提交没有动它涉及的代码，S3b、S8、S4、S10 仍然以 exit 1 结束、没有回答。

### 环境

| 分支 | 提交 |
|---|---|
| `main` | `origin/main` `bfb32c780d` |
| `pr` | `72f3d0ae04` 合并 `bfb32c780d` → `c72e773b17`（无冲突） |
| 负对照 | `pr` 构建产物的副本，只去掉 `72f3d0ae04` 在 `agent-core.ts` 里的那段改动 |

- 每个分支都做了真实的 `pnpm install --frozen-lockfile` 和 `npm run build && npm run bundle`。
- 第 2 轮之后 `main` 新增了 16 个提交。其中只有一个改到本 PR 也改动的文件：`9b4960a089`（#13126），是 `client.ts` 里一处通知记录的改动，离终止逻辑很远。
- harness、场景、MCP server 和 hook 脚本都沿用第 2 轮，未作改动。

### R7-1：已修复（图 1）

场景和第 2 轮的 S12 相同：
1. 一个前台子 agent 先执行两次失败的 `git` 调用。
2. 第三轮里它写入 `notes.txt`（成功），同时第三次执行同样失败的 `git` 调用，守卫随即终止这个子 agent。
3. 用户配置的 SubagentStop hook 阻断一次，`runSubagentStopHookLoop` 在同一个 chat 上再次发送。

续跑请求里，与被终止那一轮两个调用配对的结果：

| 分支 | 与 `write_file`、`git branch -a` 配对的结果 |
|---|---|
| `main` | 真实结果。没有守卫，子 agent 正常结束。 |
| `pr` | 真实结果：`Successfully created and wrote to new file` 和真实的 `git` 输出。**守卫触发终止的 6 次运行全部如此**。 |
| 负对照 | 两个调用都是 `Tool execution result was not recorded — … Treat as failure and retry if needed.`，2/2 次。这正是第 2 轮报告的问题。 |

细节：
- **运行次数：** `pr` 共跑了 9 次，其中 3 次守卫没有触发。这 3 次里，第二个 `git` 调用都返回了 `Output: (empty)`（就是第 1、2 轮已知的那个既有偶发问题），连续计数因此被清零。9 次的结果都在 `data/results.json` 里。
- **确认是这个守卫终止的：** 在一次开启 `--telemetry-outfile` 的运行里，这次终止被记录为 `loop_detected`，`loop_type: repeated_tool_error`，`prompt_id` 属于子 agent（`…#general-purpose-call_l0`）。
- **单测：** 新测试通过。只在源码里回退 `agent-core.ts` 那段改动，测试就会失败（1/77）。
- **静态检查：** 在真实安装上，core 的 `tsc --noEmit` 返回 0。作者落地说明里报告的 `src/code-mode/host.ts` 那 10 个错误来自作者本地环境：执行 `pnpm install --frozen-lockfile` 之后 `quickjs-emscripten-core` 就在。两个改动文件的 `eslint --max-warnings 0` 和 prettier 都通过。
- **其他终止路径（读了代码，没有实测）：**
  - 写历史的代码位于这一段里两个终止判断之后（`agent-core.ts:1353`），所以它同样覆盖了更早就有、存在同样缺口的 #9450 状态读终止（`recordToolResult`，`:1331`）。
  - 重复 provider tool-call 的终止（`:1321`）在更早的位置就 break 了。它那一批调用在执行前就被丢弃，所以本来就没有结果可记录。
- **第 2 轮遗留的问题，不阻断合入：** 守卫终止的运行是否应该允许被 SubagentStop hook 续跑。本修复只保证历史记录真实。

![图 1：新 head 上的 R7-1，对比 main 与负对照](fig1-r7-1-fixed.png)

### 第 2 轮的修复在新 head 上重跑（图 2、图 3）

- **R6-1：** 在真实 TUI 里插话，各请求中插话标记出现次数为 `[0,0,0,0,0,1,1,1,1,1]`，后续追问只带一次插话（图 3）。
- **R11-1：** S9-distinct 中 `pr` 在第 8 个请求给出回答，和 `main` 一致。
- **R11-2：** S13 中后台 agent 在两个分支上都是 `completed`。
- **该触发的地方仍然触发：**
  - S1 重复 3 次，3 次都在第 5 个请求终止；`main` 要 14 个请求。另有一次运行第三个 `git` 调用撞上偶发空输出，跑了 14 个请求，和 `main` 一样。
  - S9-same 在第 5 个请求终止；`main` 要 8 个。

![图 2：新 head 上的 headless A/B](fig2-headless-ab.png)

![图 3：新 head 上真实 TUI 里的 R6-1。插话在终止提示之前只记录一次，后续追问也只带一次。](fig3-tui-steer-once.png)

### 仍未解决：第 2 项，合入前需要裁定

和第 2 轮相比没有变化，`72f3d0ae04` 没有改 `loopDetectionService.ts`、`shell.ts` 或 `coreToolScheduler.ts`。在这个 head 上，`pr` 以 exit 1 结束且没有回答，而 `main` 都给出了回答：

| 场景 | `pr` | `main` |
|---|---|---|
| S3b：用户对 `run_shell_command(npm *)` 配置的 deny 规则 | 第 6 个请求 exit 1 | 第 9 个请求回答 |
| S8：静默 exit-1 探测 | 第 6 个请求 exit 1 | 第 9 个请求回答 |
| S4：编辑 → 重跑循环 | 第 6 个请求 exit 1 | 第 10 个请求回答 |
| S10：三条不同的命令撞上同一个 shell 超时 | 第 5 个请求 exit 1 | 第 8 个请求回答 |

这些位置上的 review 线程（R7-2、R7-7、R1-1）都已在 `72f3d0ae04` 上复核过，并标注为等待这个裁定。我维持第 2 轮的建议，二选一或两者都做：
- **(a) 不把非错误信息算作证据：** 策略拒绝（`not_started`）、超时、静默 exit-1。这样能覆盖 S3b、S8、S10。S4 是真实失败的重复，(a) 之后它照样会被终止。
- **(b) 提供阈值设置，0 表示关闭。** 这样所有情况都有退路。

### 未变的后续项（不阻断合入）

- **R11-2：** immediate-drain 分支里的 `clearToolErrorStreaks()`（本 head 的 `agent-core.ts:1396`）仍然没有单测能发现它被删掉，只有 S13 能发现。
- **ACP：** 守卫没有接入 ACP 和 daemon。
- **R4-2：** 引用 digest 的情况。
- **可见变化：** 失败的 shell 结果里多出的 `Full output sha256:` 行，仍未在说明中披露。

### 测试结果

| 检查 | 结果 |
|---|---|
| 两个分支的完整 `packages/core` 套件 | `main` 34,165 通过 / 6 失败；`pr` 34,205 通过 / 6 失败（多 40 个测试）。**失败的是同一组测试**：和第 2 轮相同的 6 个 root 用户 / 计时相关环境测试。 |
| `pr` 上的聚焦 core 套件 | `src/agents/runtime` + `loopDetectionService` + `client`：28 个文件，2031 通过，7 跳过 |
| `pr` 上的 `packages/cli` `nonInteractiveCli` | 180 通过，1 跳过 |
| 静态检查 | core `tsc --noEmit` 返回 0；两个改动文件的 `eslint --max-warnings 0` 和 prettier 都通过 |
| `72f3d0ae04` 上的 CI | 全绿：`Test (ubuntu)`、`Lint & Static`、`Integration Tests (no-AK)`。`Test (windows/macos)` 和 `Integration Tests (CLI)` 被跳过。 |

### 未验证

- 加了历史记录之后的 #9450 状态读终止（只读了代码）。
- 与第 2 轮相同的几项：
  - 调度器级别超时的端到端表现
  - R11-2 post-wait 分支的端到端表现
  - Windows、macOS、OpenTUI，以及 `qwen serve` daemon

### 证据

全部放在 [`本目录`](.)：
- 各图及其源文件
- 第 3 轮的驱动脚本
- `data/results.json`，包含每次运行的结果以及模型实际看到的工具结果

场景脚本在 `pr-10916-round2/harness/`。
