## 维护者验证：Linux 上真实构建 + 真实 daemon（`adc5c44`）

**结论：我这边认为可以合并。** 未发现阻断性缺陷。`enforce` 在真实 daemon 上的行为与 PR 描述一致：每个受管理的 ACP 子进程都恰好只拿到一个 `--max-old-space-size=<上限>`，子进程自身的 V8 上限与直接运行 `node --max-old-space-size=<上限>` 完全一致。默认模式的行为与 base 完全相同。与当前 `main` 本地合并后，结果依然成立。

关于 triage 提出的 `parseNodeOptions` 问题：作者在上方已从 Node 22 源码层面做了回应，我在四个 Node 版本上独立确认了这一结论。我还发现，机器人建议的改法恰恰会引入它所描述的 bug，而且 CI 仍会是绿的。请不要改解析器，建议改为补上 §1 中的一个小型一致性测试。

### 我运行了什么

- **三个对照臂。** 每个臂都真实执行了 `pnpm install --frozen-lockfile`、完整的 `npm run build` 和 `npm run bundle`：base `46f6aeb`（merge-base）、head `adc5c44`，以及把 head 本地合并进当前 `main` `a64d8de`（领先 57 个提交）后得到的树。全部运行在 Linux x64、Node v22.22.2 上。
- **daemon。** 每个 daemon 都从各自的 bundle 启动：`node --max-old-space-size=4096 --trace-warnings --require probe.cjs dist/cli.js serve …`，并设置 `NODE_OPTIONS=--max-old-space-size=3072`。每次运行都使用隔离的 `QWEN_HOME`、受信任的临时 workspace、loopback + token，以及一个记录所有请求的假 provider（生命周期与 A/B 运行中 provider 请求数均为 0）。
- **判定依据。** 子进程参数取自 `/proc/<pid>/cmdline`。V8 上限由子进程自己报告：`--require` 探针随继承的 execArgv 进入每个 ACP 子进程，并记录 `v8.getHeapStatistics().heap_size_limit`。

| 检查项 | base `46f6aeb` | head `adc5c44` | head 合并进 `main` |
| --- | --- | --- | --- |
| PR 的 12 个测试文件（acp-bridge 4 个、cli 8 个，含完整 `server.test.ts`） | — | 137 + 2066 通过 | 137 + 2077 通过 |
| 对 21 个改动的 TS 文件运行 `eslint --max-warnings 0`，对 27 个文件运行 prettier | — | 无问题 | — |
| `enforce` 生命周期：主 workspace、启动时次级 workspace、动态 workspace，1 个名额 × 768 MiB | yargs 拒绝 `enforce` | 38/38 项检查，共 4 轮 | 38/38 |
| `enforce` 下子进程的堆参数（含启动时预热的主 workspace 子进程） | — | 恰好为 `--max-old-space-size=768 --expose-gc`；V8 上限 **816 MiB**，与 `node --max-old-space-size=768` 相同 | 相同 |
| `observe` / `admit` / `off` 的子进程参数与 `enforced` | `4096` + `15336` 两个参数，V8 上限 **15384 MiB**，`false` | 与 base 完全相同 | 完全相同 |
| 并发准入：2 个名额，同时为 4 个新 workspace 发起请求 | — | 5/5 轮：2 个 200、2 个 503 `acp_child_capacity_exhausted`；存活子进程从未超过 2 个；对子进程 `kill -9` 后名额被释放；无残留 | 3/3 |
| 启动校验：argv 中的百分比参数、下划线拼写、`DEV` 下的 `NODE_OPTIONS`；用 cgroup `MemoryMax=900M` 模拟零名额主机 | — | 全部按预期报错并拒绝启动（fail closed）；`admit`/`observe` 不受影响 | 相同 |
| 针对 PR 生产代码行的 28 个定向变异体 | — | 杀死 25 个（未变异对照：0 失败） | — |

（图 1：同一 daemon 命令行下 ACP 子进程实际拿到的参数；图 2：`enforce` 真实生命周期 —— 见上方英文部分）

### 1. NODE_OPTIONS 反斜杠：解析器是对的，请不要采纳建议的"修复"

- **真实 Node 的行为。** Node 20.20.2 / 22.22.2 / 24.21.0 / 26.9.0 都把 `--report-filename="C:\tools\hook.cjs"` 解析为 `C:toolshook.cjs`。`ParseNodeOptionsEnvVar` 在引号内会消费反斜杠后面的任意字符，而且没有平台分支。PR 的解析器与它逐行对应。
- **差分 oracle。** 我用 `" \ = - a b x <tab>` 生成了 1,500 个带种子的随机字符串，逐一比较 `node(S)` 与 `node(rewrite(S))`。四个 Node 版本上都是 0 处差异，也没有任何 Node 接受而 PR 拒绝的字符串。
- **真实 daemon。** 我用 `DEV=true` 运行，这是 `NODE_OPTIONS` 能到达子进程的唯一启动方式。同时准备了 `dir\sub/p.cjs` 和 `dirsub/p.cjs` 两个 preload 文件。无论是引号内裸反斜杠、引号内已转义，还是不加引号的写法，daemon 和子进程每次加载的都是同一个文件。继承来的 `--max-old-space-size=3072` 被移除，子进程堆上限为 816 MiB。
- **triage 建议的改法**（"只在 `"` 前才转义"）在 Node 22 上会让 1,500 个输入中的 160 个出错：141 个解析值改变，19 个合法字符串被拒绝。例如一个正确转义的 `"C:\\tools\\hook.cjs"` 到达子进程时会变成 `C:\\tools\\hook.cjs`。
- **测试缺口。** 这个改法能通过 PR 的全部测试（变异体 M01）；去掉写回时的反斜杠转义也一样能通过（M06）。Linux CI 的路径里从不出现反斜杠，而本 PR 的 Windows `Test` 任务被跳过了。

上方英文部分给出的测试以 Node 本身作为 oracle，所以在任何平台上表现一致。我已验证它在 head 上通过，并且能杀死 M01 和 M06（[diff](patch/suggested-test.diff)）。

**影响范围。** 在任何没有设置 `DEV=true` 的启动方式下，`NODE_OPTIONS` 都不会到达 ACP 子进程：`scrubInheritedLoaderEnv` 会把它从 daemon 的基础环境中清除，项目 `.env` / `settings.env` 加载时也会通过 `isLoaderEnvKey` 跳过它。我直接检查过：子进程的 `/proc/<pid>/environ` 中没有 `NODE_OPTIONS`；即使在生产环境的 `NODE_OPTIONS` 里放一个百分比参数，也根本走不到冲突检查。生产环境中真正起作用的堆参数来自 `process.execArgv`，上面的生命周期测试覆盖了这条路径。这段改写只对 `DEV` 启动以及自行传入 `sourceEnv` 的嵌入式调用方有意义。

（图 3：NODE_OPTIONS 一致性 —— 见上方英文部分）

### 2. 每子进程的峰值度量其实已经存在

triage 和上方的回复都把每子进程峰值遥测说成缺失，或列为后续工作。其实 daemon 已经发布了这项数据（#9380）。我给运行 `enforce` 的 daemon 挂上一个 SSE watcher，然后读取 `GET /daemon/status?detail=full`。它报告了 `runtime.memory.children.heap = { peakLiveSetBytes: 106139648（约 101 MiB）, peakOldGenerationBytes: 113106944, majorGcCount: 2, majorGcMs: 14.8, reported: 1 }`，旁边就是 `limits.memory.childHeap.perChildCeilingMb: 768`。

这个值是所有被采样子进程中的最大值，而且只有挂了 watcher 时才会采样。但它正是设计文档 §6 发布步骤要求运维记录的"老生代峰值、major GC"数据。建议在发布文档中写明这个路径，这样校准就变成读一次状态接口，而不再依赖外部工具。基于这一点，我同意把 `enforce` 作为显式开启的模式先发布。

### 3. 非阻断的小问题

- `packages/cli/src/commands/serve.ts:500`：`--memory-budget-mb` 的帮助文本仍写着 "It does not change how any `qwen --acp` child is sized; the one consumer today is adaptive live-journal growth"。在 `enforce` 下，预算决定每个子进程的堆大小；在 `admit` 下，它决定子进程数量。`docs/users/qwen-serve.md` 已经更新，但 CLI 帮助文本没有。
- `packages/cli/src/serve/daemon-status.ts:475`：注释 "see `limits.memory.enforced`, which stays `false`" 已经过时。
- 百分比参数冲突要等 deferred runtime 构建时才检测，此时 listener 已经起来了。daemon 会先打印 `listening on …`，约 1 秒后以 exit 1 退出，并输出 `runtime startup failed after listener was ready: ACP heap enforcement cannot be combined with --max-old-space-size-percentage.`。这仍然是 fail closed，提示也清楚。只有当进程管理器把"已监听"当作健康状态时，才值得把检查提前。零名额分区的情况已经在监听之前就会失败。

（图 4：并发准入、启动校验、变异矩阵 —— 见上方英文部分）

### 未验证

- Windows 与 macOS 上的实际运行。我只在 Linux 上跑过；Node 的 tokenizer 没有平台分支，但我没有在 Windows 上实跑。
- 真实模型负载、GC 与延迟代价、多小时稳定性。
- PR 描述中提到的两处 macOS HTTP 状态不匹配。在 Linux 上，普通的完整 `server.test.ts` 运行在 head 上通过 1315/1315，在合并树上通过 1319/1319。
- 变异体 M09（win32 下键名大小写不敏感的查找）存活，但这段代码在 Linux 上无法执行到。

harness、变异驱动、oracle 和原始 JSON 见 asserts 分支的 [`pr-12353/`](.)。
