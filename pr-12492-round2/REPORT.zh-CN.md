## 维护者验证第 2 轮（仅增量）：PR #12492 @ `56f06075`

**结论：从我这边看可以合入。** 第 1 轮（[评论](https://github.com/QwenLM/qwen-code/pull/12492#issuecomment-5835289329)，针对 `8560fe95`）列出了合入前要修的三处，现已全部在 `56f06075` 落地。我在这个 head 上用单测、真实 bundle、真实 TUI 和真实 DashScope 端点（不计费）逐一复验，结果都成立。第 1 轮其余发现由 #12707 跟踪。本轮另发现两个触发面很窄的问题（见 §3），不影响合入。

范围：`56f06075` 是 `8560fe95` 之上的单个提交，base 不变（`64c04538`），改动 6 个文件（+107/−6）。其中生产代码改动与第 1 轮验证过的补丁**逐行一致**，另新增 6 个测试。验证环境同第 1 轮。

### 1. 三处修复在 `56f06075` 上复验

| 检查 | 结果 |
| --- | --- |
| cli 单测：batch 各套件 + `startup-prefetch`、`cli.test`、`config.test`（9 个文件） | **759/759**（753 + 新增 6 个） |
| 6 个改动文件的 `eslint --max-warnings 0` 与 `prettier --check`；`packages/cli` 的 `tsc --noEmit` | 全部 exit 0 |
| 新 bundle 上跑 `workflow-e2e.mjs` | **27/27** |
| 逐个回退修复，跑新增测试 | 恢复 R3-7 的两个判断条件 → 新的 `freezeRequest` 用例失败；`batchHomeDir` 改回 `??` → 空值用例失败；`waitForSettled` 去掉重试 → 503/429/408 三个用例全部失败；让 401 也重试 → 套件失败，但方式是崩溃（见 §3.3）。完成后工作区干净 |
| 用新 bundle 重跑第 1 轮复现脚本（假 DashScope，网络命名空间只有回环） | **R3-7**：Batch 改为发送 `enable_thinking:false`，与 realtime 一致，两个对照组不变。`qwen3.8-max` 在带 `extra_body.enable_thinking:true` 且 `/effort none` 时，Batch 改为发送 `reasoning_effort:"none"`，同样与 realtime 一致。**R3-3**：项目里不再出现 `.gitignore` 和 `tasks/`，`git status` 仍能列出两个未跟踪文件。**R3-10**：遇到一次 503 后打印警告并重试，最终交付，exit 0 |
| 真实 DashScope（不计费）：`qwen3.7-plus` 预设 + `model.reasoningEffort: "none"` | `check` 与 `run --dry-run` 从 `thinking on` 变为 `thinking off`。快照摘要随之变化（`9ebf0064…` → `2cb3dd45…`），所以在旧构建上做的预览授权不了新的冻结设置。本轮没有做付费提交 |
| 新 bundle 上的真实 TUI 回归 | 审批点仍是同样 6 个，`run --expect` 仍然弹框；交付 3 个文件，agent 被唤醒一次；启动时自动收取正常；在没有 Batch 任务的项目里开会话，Batch 请求 0 次 |
| 真实 TUI A/B：后台 waiter 第 2 次轮询时注入一次 503 | 修复前：waiter shell `failed`，agent 汇报 waiter 已停止；约 26 s 后由会话自动收取器补交付。修复后：waiter 打印 `warning: polling … failed …; retrying`，20 s 后再次轮询并交付，agent 正常被唤醒 |

![修复前后对比](r2-06-fixes-before-after.png)

![真实 DashScope：/effort none 修复前后](r2-05-real-dashscope-effort-none-ab.png)

![注入一次 503 时后台 waiter 的输出，修复前后](r2-07a-waiter-output-503-ab.png)

![注入一次 503 的 TUI：左为修复前（waiter 失败，靠自动收取补救），右为修复后（waiter 自行重试，agent 被唤醒）](r2-07b-tui-waiter-503-ab.png)

### 2. 第 1 轮的后续项

#12707 已承接第 1 轮全部非阻塞项：R3-2/4/8、R3-1、R3-9、R3-5/6、`list()` 警告、估算不含 thinking、`max output` 文案、`check` 措辞。本 head 上推迟到该 issue 的两个线程（`batch-task.ts:499`、`batch-workflow.ts:1251`）与我的实测一致。

### 3. 本轮新发现（不阻塞，建议补进 #12707）

1. **`qwen3.8-max` 系列在默认强度下与 realtime 不一致。** `8560fe95` 与 `56f06075` 上表现相同，不是本次提交引入的。使用 ModelStudio 预设条目时，realtime 会发送预设的 `defaultEffort`，即 `reasoning_effort:"xhigh"`；Batch 不带强度，预览显示 `thinking: provider default`。条目里如果还带 `extra_body.enable_thinking:true`，realtime 会丢弃这个竞争开关（`dropConflictingThinkingKnobs`），Batch 却发送 `enable_thinking:true` 且不带强度。两种情况都不打印 `[batch] note:`。也就是说，“与 realtime 同条件”在 `/effort none` 下成立，在分档模型的默认强度下不成立。建议二选一：冻结实际生效的强度档位，或者打印已有的 “reasoning effort is not reproduced” 提示。
2. **`waitForSettled` 现在会重试本地路由守卫的拒绝。** 所有不带 HTTP 状态码的错误都被当作瞬时错误，其中也包括 `batchRequest` 自己抛出的 `refusing a request outside the Batch API paths`。账本里的 batch id 为 `batch-1:x` 时，`collect --wait --timeout 25` 以前 0.5 s 就 exit 1；现在打印 2 次重试警告，拖到 25 s 超时才退出。而 `/batch-api` 启动 waiter 时不带 `--timeout`，会无限轮询。按代码阅读，会话收取器在连续 3 次失败后仍会提示用户。DashScope 的 id 形如 `batch_<uuid>`，触发不到；不规范的 provider id 或手改过的账本会触发。修法：把守卫错误标记为确定性错误，直接抛出。
3. **测试小问题。** `stops waiting at once on a definite client error` 依赖被测代码自己终止。如果变异体把 401 也当作可重试，它会在 mock 的 `sleep` 下死循环，直到 vitest worker 堆内存耗尽。变异体仍然被检出，但靠的是崩溃而不是断言。在 mock 里限制轮询次数，就能变成正常的断言失败。

注：本 PR 上的 `CHANGES_REQUESTED` 评审针对的是 `8560fe95`。其中我判定为阻塞的三项已在本 head 修复，其余已转入 #12707。

证据（截图、新增探测脚本 `r3-07b-tiered-qwen38max.mjs` 与 `r2-01-guard-refusal-retried.mjs`、原始日志）：（本目录）
