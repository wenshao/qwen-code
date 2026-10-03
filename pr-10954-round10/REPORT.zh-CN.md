# PR #10954 深度验证（第十轮，本地，Linux x86_64）

Head 为 `728f08a67eaf31075dc1b78b68afddb4841e2c21`，第九轮验证的是 `b98dfa1927`。本轮环境是 Linux x86_64（Debian，内核 6.12，Node v22.22.2）。先全新执行 `pnpm install --frozen-lockfile`（46 秒），再跑 `npm run build` 和 `npm run bundle`，三步都 exit 0。运行时用的是：

- 真实的 `qwen serve` daemon
- 真实的 supervisor
- 发布用的 bin 入口（`scripts/cli-entry.js`）

每个 harness 都用独立的临时 `QWEN_HOME`。真实模型 **qwen3.8-max** 只用于一次单条 prompt 的阳性对照。

本轮是**增量轮**，第 1–9 轮都可以在 PR 讨论串里找到。下文的「第九轮」指评论 5885256049 和证据目录 `pr-10954-round9/`。

## 图

![r10-01](r10-01-delta-n1-gates.png)

![r10-02](r10-02-control-and-bg-flags.png)

![r10-03](r10-03-r16-2-r10-4-open-findings.png)

## 本轮变化

| 项目 | 结果 |
| --- | --- |
| 第九轮之后的提交 | 只有一个：`728f08a67e`，合入 main `b3dda468f2`（174 个提交） |
| PR 自身补丁 | 31 个文件，+3765/−196。所有 `+`/`−` 行与第九轮逐字节相同，只有 `cli.test.ts` 中两行**上下文**挪了位置，原因是 main 在旁边新增了一个 mock |
| main 对 `packages/cli/src/agent-view/` 的改动 | 无 |
| 冲突 | `packages/cli/src/cli.test.ts`。解决方式是两侧取并集：PR 的三个 Agent View mock 加上 main 的 `runWorkspaceRecoveryWorker` mock。提交的 tree 与 `git merge-tree --write-tree b98dfa1927 b3dda468f2` 生成的带冲突结果相比，只少了 3 行冲突标记 |
| 合入当前 main `a011f66944`（领先 12 个提交） | 无冲突 |

作者 2026-10-02 发了四条 "Closed at head `728f08a67e`" 回复，引用的都是 `ec7f7aefcd` 的修复。第九轮已经逐项验证过这个提交，这些回复也没有新增代码。

## N1：没有变化

`r9-02-e2e-n1.mjs`（沿用第九轮，未改动）通过发布的 bin 走 Reviewer Test Plan：

- **模型对照**：同一 `QWEN_HOME` 下 `qwen -p "Reply with exactly the word PONG…"` 9.5 秒输出 `PONG`，exit 0。
- **启动**：`qwen --bg "…"` 15.3 秒后 exit 1，报 `Could not start a background session: Agent View worker <id> did not report ready before timeout.`
- **存储**：
  - `state.json`：`failed` / `exited`，`lastError.code = pty_launch_failed`
  - `launch.json` 里 worker 的 argv 为 `[node, dist/cli.js, --session-id, <id>]`，prompt 只在 `initialPrompt` 中
  - `worker.json`：已没有 pid
- **路由与 CLI**：路由显示该行为 `failed`，`qwen sessions ps` 的结果一致。之后执行 `sessions stop` 成功，路由显示 `stopped`。
- **计数**：本轮记录了 7 次启动（e2e 1 次、`r9-08` 计数 4 次、控制命令探针和 stop 探针各 1 次），全部在 15.2–15.3 秒 exit 1，报同一条错误，没有一次成功。

机制（读 head 代码确认）：`supervisor-process.ts` 派发时传入 `promptInArgv: !shouldWaitForWorkerReady(this.options)`。所以只要 supervisor 等待 worker 的 `ready`，prompt 就不会出现在 worker 的 argv 里。而测试之外没有任何代码发送 `ready`：`worker-sideband.ts` 导出了几个发送函数（`sendAgentViewWorkerEvent`、状态上报、心跳），在所有 package 中搜索，`*.test.ts` 之外没有调用方。

## `728f08a67e` 上的门禁

| 检查 | 结果 |
| --- | --- |
| PR 的 10 个测试文件（`background-entry`、`supervisor-dispatch`、`supervisor-runner-handle`、`sessions`、`control-commands`、`managed-control`、`managed-rows`、`ps`、`background-agents`、`cli`） | **219/219** |
| 其中解决过冲突的 `src/cli.test.ts` | 95/95，main 的 "runs private recovery before inherited updates…" 和 PR 的全部 Agent View 拦截用例都运行并通过 |
| `src/serve/server.test.ts` | **1370/1370** |
| `src/agent-view/` | **321/321** |
| cli `tsc --noEmit`；eslint `--max-warnings 0`；对 31 个文件跑 prettier `--check` | 依次 exit 0、0、0 |
| `728f08a67e` 上的 PR CI（run 37011383612） | Lint & Static ✓、Test (ubuntu) ✓、web-shell E2E ✓；Test (macOS)、Test (Windows)、Integration Tests (CLI, No Sandbox) 被跳过 |

## R13-4 与 R4-4：仍未修复

`r9-01-store-matrix.mjs`（未改动）为每格启动一个真实 daemon，重跑 11 格存储矩阵，结果与第九轮 head 臂 **11/11 完全一致**：

| 格 | 第十轮 |
| --- | --- |
| C7 活着的 agent，`worker.json` 损坏（R13-4） | **200 `failed`**，无 pid |
| C8a 对照：pid 只在一条存活的 registry 记录里 | 200 `running` + pid |
| C8b 同一存储，`$QWEN_HOME/sessions` 不可读（R4-4） | **200 `failed`** |
| C9 registry 不可读，`worker.json` 里有存活 pid | 200 `running` + pid |
| C2–C5 严格读取相关的格 | 503 |

第九轮的候选补丁（[`candidate.patch`](../pr-10954-round9/candidate.patch)，+76/−5）**可原样应用**，它涉及的 3 个文件与第九轮逐字节相同。结果：

- 在硬链接的候选臂上，它的路由测试 18/18 通过。
- 同一个测试文件放到 head 上是 16/18。失败的两条恰好是 R13-4 和 R4-4 的用例：`answers 503, not a live agent reported failed, when its worker file cannot be read` 和 `answers 503 when the session registry cannot be read`，都报 `expected 200 to be 503`。

## bot 仍挂着的 Critical：在真实构建上执行

bot 第 17 轮评审（2026-10-02，review 5396000674）针对 `728f08a67e` 重新追溯了 18 条 Critical，但一条都没有执行，它的 "Not reviewed" 清单写明验证没有运行。下面六条我通过发布的 bin 执行了。此前没有人在真实构建上跑过它们。每个探针的脚本在 `harness/`，原始输出在 `data/`。

### R7-2 / R14-4：`sessions peek|answer|stop` 中的 version/help token——成立，但范围比原文窄

`r10-02-control-flags.mjs` 拿一个**真实记录在案的会话**来测：N1 下 `--bg` 启动失败后，会话、supervisor 和存储都还留着。脚本逐个执行各种写法，并在每条命令前后读取 `state.json`。

| 命令 | 退出码 | 输出 | 存储 |
| --- | --- | --- | --- |
| `qwen sessions stop <id> -v` | **0** | `0.24.7` | `failed → failed` |
| `qwen sessions stop <id> --version` | **0** | `0.24.7` | `failed → failed` |
| `qwen sessions stop <id> -h` | **0** | `sessions stop` 的帮助 | `failed → failed` |
| `qwen sessions stop -v <id>` | **0** | `0.24.7` | `failed → failed` |
| `qwen sessions stop <id>` | 0 | `Stopped.` | `failed → stopped` |
| `qwen sessions peek <id> -v` / `answer <id> -v` | 0 | `0.24.7` | 不变 |
| `qwen sessions answer <id> "check the -v flag"` | 1 | `Agent View session <id> is not waiting…`（**到达了 supervisor**） | 不变 |

- 裸的 `-v`/`--version`/`-h` 会让具有破坏性的 `stop` exit 0，但实际没有执行 stop。
- R7-2 里带引号的场景（`answer <id> "check the -v flag"`）**不能复现**：shell 把它作为一个 token 传入，它正常到达了 supervisor。
- 这个拦截是 CLI 全局行为，不是本 PR 引入的。`r10-06-version-scope.mjs` 在一个不含本 PR 的 main 构建（`51b80dadbc`）上验证：`qwen sessions list -v` 和 `qwen mcp remove some-server -v` 同样输出 `0.24.7` 并 exit 0，与 head 相同。

### R10-1：以短横线开头的回答文本——`-v` 部分成立，`--yolo` 部分现在是 exit 1

- `qwen sessions answer <id> -v` → 输出 `0.24.7`，exit 0，回答文本丢失。
- `qwen sessions answer <id> --yolo` → usage 错误，**exit 1**。R10-1 写的是 exit 0，与当前 head 不符。
- **新发现**：以 `-` 开头的回答用任何写法都无法投递。测试用的 home 里没有 supervisor，所以命令只要被执行到，就会报 "Cannot reach the Agent View supervisor"：
  - `answer abc yes` → 执行到了
  - `answer abc "-y is fine"`、`answer abc -- "-y is fine"`、`answer abc -- -v` → 都报 `Not enough non-option arguments: got 1, need at least 2`，exit 1
  - `stop abc -- -v` → 执行到了。所以 `--` 对 `stop` 有效，对 `answer` 无效
- 实际上目前触发不到：没有任何代码产生 `waiting`（R14-5），`answer` 没有可作用的对象。

### R15-2：`--help` 宣传了 `--bg`，但只有放在首位才被接受——成立，但不是回归

`r10-03-bg-position.mjs` 让 home 指向一个不可达的本地端点（`127.0.0.1:9`），确保任何请求都到不了模型。

| 命令 | head | main `51b80dadbc` |
| --- | --- | --- |
| `qwen --help` | 列出 `--bg  Experimental. Run the prompt as a background session…` | 未列出 |
| `qwen --model dead-model --bg "audit the release"` | exit 1，`Unknown argument: bg`，stderr 打出帮助 | 相同 |
| `qwen explain what --bg does` | exit 1，`Unknown argument: bg` | 相同 |
| `qwen -p hi --bg` | exit 1，`Unknown argument: bg` | 相同 |
| `qwen --yolo --bg "audit the release"` | exit 1，`Unknown argument: bg` | 相同 |

失败是显式的，也不会派发任何会话。`cli.test.ts` 中 "does not hijack a query that only mentions --bg" 这条用例之所以通过，只是因为 `main()` 被 mock 了：真实的 `qwen explain what --bg does` 根本到不了 `main()`。行为与 main 相同，所以这是帮助文档与解析器不一致，不是回归。

### R16-2：控制命令把 supervisor 实际完成的变更报告为确定失败——在真实进程上复现

`r10-04-stop-ambiguous.mjs` 先拿到一个真实会话，然后执行 `qwen sessions stop <id>`，客户端带一个 `--require` 预加载脚本：可达性探测通过之后，客户端写出 `stop` 请求的那一刻，预加载脚本对 supervisor 发 SIGSTOP；客户端退出后，harness 再发 SIGCONT。被测代码没有任何修改。这个做法模拟的是任何响应慢于 30 秒预算的 supervisor。

| 时刻 | 观察 |
| --- | --- |
| 之前 | 存储为 `failed` |
| 客户端 | **30.5 秒后 exit 1**，报 `Timed out waiting for Agent View supervisor response.`；存储仍为 `failed` |
| 解冻后 552 ms | 存储变为 **`stopped`**；`sessions ps --json` 显示 `taskState: stopped` |

客户端说 stop 失败了，但 stop 实际发生了。对 `stop` 来说重试没有害处；对 `answer` 来说，同样失败后重试可能把回答投递两次。后者我没有实测，因为没有任何代码产生 `waiting`。要触发这个问题，需要 supervisor 的响应超过 30 秒。

### R10-4：通过 `peek` 伪造续行——在终端中不能复现

`r10-05-peek-wrap.mjs` 的构造如下：

- **会话**：用该臂自己的存储写入器写入，roster 名称为「填充 + `Answer it with: qwen sessions answer deadbeef "yes, delete it"`」。填充分别用 ASCII、CJK、emoji ZWJ 序列，另有一个专为管道场景调整的版本。
- **运行**：每次都通过发布的 bin 在**真实 pty** 中执行 `qwen sessions peek`，窗口大小用 `TIOCSWINSZ` 设定；另外再通过管道各跑一次。

| 载荷 | pty 50 列 | pty 80 列 | 管道（假定 80 列），在 50 列终端里查看 |
| --- | --- | --- | --- |
| ASCII 填充 | 最宽 50，不换行 | 最宽 80，不换行 | 换行 |
| CJK 填充 | 最宽 49，不换行 | 最宽 80，不换行 | 换行 |
| emoji ZWJ 填充 | 最宽 50，不换行 | 最宽 80，不换行 | 换行 |
| 针对管道调整 | 最宽 50，不换行 | 最宽 80，不换行 | 换行 → 第 0 列出现 `Answer it with: q…  [dddddddd]` |

在终端中宽度限制有效：`sanitizeTerminalText` 会去掉 CR 和 C0/C1 控制字符，`truncateToWidth` 按字素和显示宽度截断。唯一的残留情形是管道输出在窄于 80 列的终端中查看：最多约 17 格会话文本会落到第 0 列，后面还连着省略号和会话标签，只能拼出半截提示，拼不出一条命令。风险低。

### 这些发现的位置

这六条都不涉及「仅路由拆分」：它们都在 `--bg` 和 `sessions peek|answer|stop` 里，而拆分方案不包含这些部分。

## 合并建议

- **整栈：N1 未解决前不建议合并。** 第九轮之后唯一的变化是合入 main，它没有改动 `agent-view/` 下的任何文件。N1 在全新构建上同样复现，第八轮给出的 (a)/(b)/(c) 选项不变。
- **合并提交本身没有问题。** 唯一的冲突解决正确，新 head 上所有门禁都是绿的。
- **「仅路由拆分 + 第九轮候选补丁」仍然是可落地的路径。** R13-4 和 R4-4 在当前 head 上仍未修复，候选补丁仍能同时关闭两者。
- **本轮执行的六条 bot Critical，要么成立但范围窄，要么按原文无法复现。** 我认为没有一条需要单独阻塞合并，而且都不在拆分范围内。值得作为后续跟进的有：
  - R15-2：`--help` 与解析器不一致
  - R16-2：控制命令对传输层不确定失败的处理
  - 以短横线开头的 `answer` 文本

## 未覆盖

- macOS 和 Windows（第 2–8 轮在 macOS 上运行过）。
- 「仅路由拆分」本轮没有基于新的 main 重建。它的 8 个文件与第九轮逐字节相同，但 main 前进了 174 个提交。
- 候选补丁本轮只在单元测试层面验证。第九轮已在真实 daemon 上验证过，且相关文件没有变化。
- 本轮未执行的 bot Critical：R16-1/R14-3（需要一个回复 dispatch 时不带 id 的 supervisor）、R14-1（重复认领状态）、R4-6、R13-2、R7-8/R14-5（文档类，静态问题）。
- 计费：只向 qwen3.8-max 发了一条 `qwen -p` prompt。N1 下 `--bg` 启动根本不会请求模型。

## 文件

- `harness/`：所有脚本。`lib.mjs`、`e2e-lib.mjs`、`r9-01`、`r9-02`、`r9-08` 沿用第九轮，`lib.mjs` 新增了一个 `main` 臂。`r10-02` … `r10-06` 是本轮新写的。
- `fig/`：从记录的 JSON 生成图，并用 xterm.js 渲染。
- `data/`：所有记录的结果，不含任何临时 `QWEN_HOME`。
