## 本地验证第 3 轮（head `81fecd5f`，Linux）

这一轮的推送改了生产代码：伪会话白名单（R1-5）、独立的 options 接口（R1-10），以及首轮 catch-up 的新覆盖。所以前两轮的结论我没有直接沿用，而是重新构建，用真实的交互式 CLI 重跑了一遍。这次在 **Linux** 上跑，前两轮在 macOS 上。

**结论：建议合并。** 本轮每一项处理都经过核实。白名单里的名字是真实存在的文件，`qwen serve` 每次启动都会写它。测试隔离修复（R1-6/7）防住的是真实的数据丢失，我复现了这一点。我没有发现阻塞性缺陷。`81fecd5f` 上的 CI 全绿。唯一还在阻塞的是 bot 在 02:38 给出的 `CHANGES_REQUESTED`，它针对的是分支状态，现在已经解决，维护者 approve 一次即可解除。

<details>
<summary><b>验证对象</b></summary>

| | |
| --- | --- |
| 验证树 | `main ec109102e0` 合并 PR head `81fecd5f` → `5945a4a7d6`。合并干净：`9 files changed, 466 insertions(+), 7 deletions(-)` |
| 对照组 | **PR**：上述树，用 `pnpm install` 构建（`prepare` 会完成 build 和 bundle）。**base**：另开的干净 `main ec109102e0` worktree，同样方式构建。**r2-equiv**：在 PR 的 bundle 里改一行 `dist/chunks`，即 `PSEUDO_DEBUG_SESSION_STEMS = new Set([])`，对这两个名字的行为与第 2 轮相同 |
| 平台 | Linux 6.12.63 x86_64，Node v22.22.2，pnpm 11.24.0 |
| 隔离 | 每个场景都有独立的 `HOME`、`QWEN_HOME` **和** `QWEN_RUNTIME_DIR`，并使用专用 tmux socket。本机真实的 `~/.qwen/debug` 运行前是 7 048 项，运行后仍是 7 048 项 |
| 证据与装置 | [`wenshao/qwen-code@asserts:pr-12374/`](https://github.com/wenshao/qwen-code/tree/asserts/pr-12374)：截图、原始 JSON 快照、日志和全部脚本 |

![被测的真实 TUI](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12374/00-tui.png)

</details>

### 1. 真实 TUI，17 项 fixture，三个对照组

三个对照组使用同一份预置的 `runtime/debug`，`general.cleanupPeriodDays = 30`。TUI 以 `--session-id 7777…` 启动后保持空闲。首轮清理在启动后 **62 秒**触发，走的是 catch-up 路径。

![S1 base 与 PR 对比](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12374/01-s1-fixture.png)

| 条目（年龄） | base | r2-equiv | **PR** |
| --- | --- | --- | --- |
| 过期 `<uuid>.txt` ×2（60 天、31 天），过期 `<uuid>-agent-Explore-….txt` | 保留 | 删除 | **删除** |
| `transcript-replay.txt`、`workspace-mcp-discovery.txt`（60 天） | 保留 | 保留 | **删除** ← 本轮新增 |
| 近似名（60 天）：`Transcript-Replay.txt`、`workspace-mcp-discovery-old.txt`、`transcript-replay.log`、`notes.txt`、`startup--root-git.txt` | 保留 | 保留 | 保留 |
| 29 天的 `<uuid>.txt`，5 分钟前的 `<uuid>.txt` | 保留 | 保留 | 保留 |
| 名为 `<uuid>.txt` 的**目录**；名为 `<uuid>.txt`、指向目录外 60 天旧文件的**软链** | 保留 | 保留 | 保留，目标文件完好 |
| 当前会话自己的日志（`--session-id`，60 天） | 保留 | 保留 | 保留。**对照组**不带 `--session-id` 时：被删除 |
| 指向过期日志的 `latest` | 保留 | 悬空 | 悬空（描述中已写明） |
| `daemon/`（内含 60 天旧文件） | 未动 | 未动 | 未动 |
| `QWEN_HOME` 下的 marker | 无 | `…-204253998b2e41a8` | `.debug-logs-cleanup-402f6a658f87ed2d` = `sha256(<runtime>/debug)[:16]` |

### 2. 白名单里的名字是真实的守护进程文件（R1-5）

![S2/S4 真实 qwen serve](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12374/02-daemon-writer.png)

- **`workspace-mcp-discovery.txt` 由 `qwen serve` 自己写出。** 开启 `QWEN_DEBUG_LOG_FILE=1` 时，守护进程启动就会创建它，不需要任何会话、prompt 或 MCP 请求。我连续重启守护进程三次，其间只有 `/health` 探测。文件从 4 808 增长到 9 616、再到 14 424 B，每次启动追加一段初始化日志，从不轮转。在 `main` 上没有任何机制会删除它。
- 我复制了这份由守护进程写出的目录，把其中的 `*.txt` 调到 45 天前。**PR** 删除了这个文件和两个过期会话日志，**base** 全部保留。一份未调时间的新鲜副本在 **PR** 下也全部保留，说明 mtime 截止线在起作用。
- **写入方仍在运行时。** 守护进程还在跑，文件是 2 小时前的，TUI 设置 `cleanupPeriodDays: 0`。清理删掉了这个文件，守护进程照常工作：`/health` 返回 200，新一轮 prompt 返回 202，会话日志继续增长。这个文件只在创建发现配置时写入。之后的 `POST /workspace/mcp/reload` 写进的是进程级的会话日志，所以清理不会丢失任何之后本该追加进来的内容。
- **`transcript-replay.txt`：我没能产出它。** 对一个真实、已持久化的会话调用 `GET /session/:id/transcript`，返回 200，但没有生成这个文件。`extMethod` 在 `newSessionConfig` 之前就绑定了目标会话 id，所以这条路由走不到兜底分支。把它列入白名单仍然无害：名字是精确匹配，并且受 mtime 约束。

### 3. 真实的 7 048 项 debug 目录（Linux）

语料是本机真实的 `~/.qwen/debug`：147 MB，其中没有任何文件比 30 天更新。我用 `cp -a` 只读地复制到两个隔离的 runtime 目录。每个对照组都在开启 `QWEN_DEBUG_LOG_FILE=1` 的情况下运行 TUI，这样产品会把自己的 housekeeping 结果写进日志。

![S3 真实语料](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12374/03-real-corpus.png)

- **PR** 在自己的会话日志里记下 `debug-logs: removed=7043 errors=0`，这一步约 **106 ms**（按这一行与前一条 housekeeping 日志的时间差计算）。目录从 7 049 项、147 MB 降到 6 项、14 MB，剩下的 14 MB 是 `daemon/`，它的目录树哈希前后完全一致。清理前我用同一判断条件做过只读预演，预测会删 **7 043** 个，与实际完全相同。
- 留下的条目都是对的：3 个是旧版本遗留的非会话文件名（`startup--root-git-qwen-code.txt`、`startup--root-git.txt`、`test-session-123.txt`），其余是当前会话日志、`latest`（已重新指向当前会话）和 `daemon/`。
- **base**：同样的 TUI 日志里没有 `debug-logs` 这一行，没有写 marker，7 049 项（147 MB）全部原样保留。

### 4. 测试：本轮改动实际约束住了什么

![测试隔离 A/B 与变异矩阵](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12374/04-tests.png)

- **R1-6/7 修的是真实的数据丢失，不只是代码卫生。** 我导出指向哨兵 debug 目录的 `QWEN_RUNTIME_DIR`，在生产代码固定为 PR head 的前提下运行两个 housekeeping 套件。用第 2 轮的测试文件，**测试运行删掉了哨兵目录 5 个文件中的 4 个**，另有 8 个用例失败。换成第 3 轮的测试文件，65 个全部通过，哨兵目录原样未动。在这个修复之前，shell 里设置了 `QWEN_RUNTIME_DIR` 的开发者，只要跑一次 `vitest` 就会丢掉真实日志。
- **变异矩阵：12 个变异体，杀死 10 个。** R1-1（去掉 OpenAI marker）、R1-5（清空白名单）、R1-10（调用处传 `() => true`）三个变异体**在第 2 轮测试下存活，在第 3 轮测试下被杀死**，说明约束住它们的正是本轮新增的测试。R1-8（清空后 `rmdir` 根目录）在第 2 轮就已被杀死：对已删除的根目录调用 `readdirSync` 会抛 `ENOENT`。本轮加上明确的 `existsSync`，让这个意图一目了然。存活的是 A1（白名单放宽为前缀匹配）和 A2（大小写不敏感匹配），都属可选项，见下文。
- 在 Linux 上以非 root 用户运行，两个套件 65/65 通过。以 root 运行有 3 个失败，其中 2 个在 `main` 上同样失败（2/53）。这 3 个都是基于 `chmod` 的 `EACCES` 用例，root 不受权限位限制。这是仓库既有的写法，不是本 PR 的缺陷。

### 5. 门禁

| | |
| --- | --- |
| `81fecd5f` 上的 CI | 全绿，包括 `Test (ubuntu)`、`Lint & Static`、`Integration Tests (no-AK)`、`web-shell E2E Smoke` 和 `review-pr`。macOS 与 Windows 的 `Test` 与之前一样被跳过 |
| `npm run typecheck`（全部 workspace） | exit 0 |
| 改动文件的 `eslint` 与 `prettier --check` | 干净 |
| `npm run generate:settings-schema` | 无 diff，IDE schema 与 `settingsSchema.ts` 一致（R1-4） |
| `settingsSchema.test.ts` + `startup-prefetch.test.ts` | 91 通过 |

### 6. 非阻塞项

1. **尽快把 R1-3 的后续 issue 开出来，免得遗忘。** 目前还没开。本轮之后它更重要了：新加入白名单的文件由 `qwen serve` 写出，但单独运行的守护进程永远不会执行这次清理。它会写 `.openai-logs-cleanup-*`，从不写 `.debug-logs-cleanup-*`，两次守护进程运行中我都观察到了这一点。所以只用守护进程的用户，仍会不断积累这个文件和所有会话日志。
2. **频繁启动守护进程会让 `workspace-mcp-discovery.txt` 持续增长。** 每次启动追加约 4.8 KB 并刷新 mtime，所以每月至少启动一次守护进程的用户，这个文件永远不会超过截止线。量很小，也受启动频率限制，但靠保留期规则解决不了。修复应该放在写入端（每进程一个文件，或初始化时截断），可以以后再做。
3. **可选：** 加一个近似名 fixture（例如 `workspace-mcp-discovery-old.txt`），就能杀死 A1 和 A2。真实二进制已经会保留这些名字（第 1 节），这只是把行为固定下来。

**未验证：** Windows（从未验证），以及本轮的 macOS。前两轮在 macOS 上跑的是更早的 head，本轮的生产代码改动是白名单加一个 options 接口，都与平台无关。

原始快照、变异 JSON、日志和完整装置：[`wenshao/qwen-code@asserts:pr-12374/`](https://github.com/wenshao/qwen-code/tree/asserts/pr-12374)。
