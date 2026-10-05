## 维护者验证：#13361 @ `1dcda71`（真实 Hosted 拓扑，Linux + MySQL 8.4）

**结论：可合入。** 对 #13255 的确切失败形态，修复正是靠读重试实现的；新增的拒绝标签能进入保留的 JUnit 产物。另有一项不阻塞的改进点：Store 把损坏判定统一回 HTTP 500，因此会被重试。还有一项测试侧后续：我复现的竞态位于 driver 的 Store 代理。

这次运行也执行了今天 /review [R2-6](https://github.com/QwenLM/qwen-code/pull/13361#discussion_r4180146607) 提出的变异证明（R2-6 要求一个读故障见证）。我用的是本地钩子，R2-6 要求的 IT 用例仍需落地：
- 把重试强制关掉后，CI lane 的 IT 以 issue 自身的签名失败，保留输出点名 `workspace_verify`。
- 保持 PR 原样时，同一故障被吸收，IT 保持绿色。

### 跑了什么

- **测试：** CI lane 自己的 `HostedWorkspaceToolTurnIT#packagedHarnessUsesSavedWorkspacesThroughRealBrokerWorkerAndSqlStore`，使用 Spring Session Store、内嵌 Runtime Broker 与 bundled worker。
- **环境：** Docker 中的 MySQL 8.4，Linux，Node 22.22.2，JDK 21，4 条 lane 并行。Java 未改动。driver 与 process helper 只加了环境变量门控的钩子，未设置时不起作用。
- **四个 bundle：**
  - **A** = main `9915c7f`，即 PR base。
  - **T** = A 加上本 PR 的 `hosted-harness-session.ts`（有标签、无重试）。
  - **M** = PR head，把 `withRetry` 的退出守卫强制为 `true`。这样重试被关掉，即 R2-6 的变异。
  - **H** = PR head `1dcda71`。
- **故障目标：** 只武装一次冷加载，即 CI 失败的那一次：第 2 个文件 Workspace 会话，在 `SHELL_REFUSAL` → `/title` → `/detach` 之后，driver `:836`。
- **故障类型：**
  - 一个 daemon preload：在第 N 次 Store 资源 fetch 之前同步阻塞事件循环，用来模拟饥饿的 runner。它同时记录每一次被拒的 Store fetch 及其 undici cause 链。
  - 在 driver 现有 Store 代理里注入的故障：一次、两次，或对每个匹配请求都注入。
- **合计：** 55 次 IT 运行。

![结果矩阵](fig1-matrix.png)

### 发现

1. **复现了机理，断言签名与 CI 相同。**
   - 在 A 上，于 `verifyWorkspaceRestore` 并行读突发的第一个读取之前停顿 6 s，3/3 失败。每次都是在被拒的 `SHELL_REFUSAL` 回合之后，`javaLoad` 处 `409 !== 200`。没有任何输出点名门禁，与 CI 相同。
   - 每次 probe 都只记录到一个被拒的 fetch：`TypeError: fetch failed ← SocketError: other side closed (UND_ERR_SOCKET)`。
   - 原因：driver 的 Store 代理是一个 Node `http.Server`，`keepAliveTimeout` 为默认的 5 s。它在停顿期间关闭了 daemon 池里空闲的 socket，daemon 之后又复用了这个 socket。
   - 停顿 3 s 时（A、T、H 各跑一次），都不失败。
2. **重试是承重的。**
   - H 3/3 通过。被拒的读在 250–280 ms 后重发，加载返回 200。
   - M（即去掉重试的 H）2/2 失败，签名相同。
   - 若停顿落在 open 阶段的读之前（第 1 或第 2 次资源读），A 与 T 以 `managed_session_open_failed` 失败，H 返回 200。这个失败是 daemon 的 503，IT 经 Java probe 看到的是 HTTP 500。它已有 `Hosted Session open failed:` 日志。
3. **标签能保留到产物里。**
   - T 与 M 的 failsafe 报告含有 `load refused (workspace_verify): … fetch failed.`。M 还点名了端点（`GET /resources/<id>… failed:`）。
   - `/writers:renew` 应答丢失是在 A 上走到同一个静默 409 的第二条路径。T 与 M 把它标记为 `workspace_writable`，H 则恢复成功。
4. **重试契约在真实 Store 上成立。**
   - Store 接受了重复的 `/writers:renew`，加载返回 200。
   - commit 应答丢失在 A 与 H 上表现相同。[`appendTransaction`](https://github.com/QwenLM/qwen-code/blob/1dcda71cd6550c7524a05bcca961004edd0401a8/packages/core/src/managed-runtime/http-managed-session-store.ts#L583) 里既有的三次尝试循环本就会吸收它。在激活 commit 之前停顿 6 s，两臂都是绿的（各跑一次）。这与 PR 描述中"CI 从未出现 commit 路径失败"的观察一致。
   - 404 从不重试。
   - 持久 503 最终仍是同样的拒绝。在 open 阶段，H 用 3 次请求、751 ms，A 是 1 次、60 ms。在 verify 突发阶段，H 用 78 次请求（26 × 3，全部在 409 之前）、857 ms，A 是 26 次、89 ms。
   - `/restore?` 挂起时，H 用时 30.03 s、1 次请求，A 是 30.04 s、1 次请求。triage 担心的超时叠加在此 head 上不存在。
5. **竞态在不注入时也会发生。**
   - 有两次，同样的 `other side closed` 在 H 的冷加载中出现，而那次加载我并没有武装。两次加载仍返回 200，IT 保持绿色。代理日志没有覆盖这两个时间窗，但在这些臂上只有重试能挽回被拒的读。
   - 两次之前都没有 daemon 的 `event loop stall detected` 告警（循环最大延迟达到 1 s 即会输出）。#13339 引用的三个失败 CI job 的日志里也没有这条告警（0 次匹配）。
   - 所以竞态并不需要长停顿；停顿只是让它变得确定可复现。CI 日志没有 cause 链，因此把 CI 的失败归因于这个竞态是推断。在这里，它是唯一能在同一调用点产生同一断言的机理。

![保留输出对照](fig2-retained-output.png)

### 说明（不阻塞）

- **N1：Store 的损坏判定是 HTTP 500，因此会被重试。**
  - Java Store 对 `managed_session_resource_corrupt`、`managed_session_journal_corrupt`、`managed_session_head_corrupt` 一律回 500（[`resourceCorrupt`](https://github.com/QwenLM/qwen-code/blob/1dcda71cd6550c7524a05bcca961004edd0401a8/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedSessionStore.java#L1278-L1282)、[`journalCorrupt` / `headCorrupt`](https://github.com/QwenLM/qwen-code/blob/1dcda71cd6550c7524a05bcca961004edd0401a8/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedSessionStore.java#L1447-L1457)）。
  - 瞬态服务端故障则是 500 `internal_error`（[`ApiExceptionHandler`](https://github.com/QwenLM/qwen-code/blob/1dcda71cd6550c7524a05bcca961004edd0401a8/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/api/ApiExceptionHandler.java#L76-L83)）。
  - 在 IT 有意制造的损坏 seal 拒绝中，H 读取损坏资源 3 次，A 只读 1 次。标签随之写成 `failed after 3 attempts: The Managed Session resource failed verification.`。
  - 结果不变，Risk 一节也已接受额外的尝试。但这个措辞容易让读者把一个确定性判定当成瞬态。
  - 一个低成本改进：`remoteCode` 以 `_corrupt` 结尾的 5xx 不重试。
- **N2：我复现的竞态位于测试 harness。**
  - 我在 A 上重复 6 s 停顿，同时把 driver Store 代理的 `keepAliveTimeout` 调到 65 s。结果 2/2 通过，被拒 fetch 为 0。
  - 代理还会原样复制所有上游头，包括逐跳头（[`Object.fromEntries(response.headers)`](https://github.com/QwenLM/qwen-code/blob/1dcda71cd6550c7524a05bcca961004edd0401a8/integration-tests/helpers/hosted-workspace-tool-turn-driver.ts#L167)）。
  - 在 harness 侧改一行，应该能为经过代理的所有 Store 调用去掉这个触发条件。其中包括仍绕过重试的 `publicationRequest` 各分支（[R1-2](https://github.com/QwenLM/qwen-code/pull/13361#discussion_r4178009346)，已延后）。
  - 这项修复是本 PR 的补充，而不是替代：daemon 侧重试对真实中间件而言本就是正确行为。
  - R2-6 建议的 IT 用例在这个代理上很容易补。我的钩子都在证据目录里。

### 其他核对

- **head 上的单测：** core store 套件 33/33，cli `hosted-harness-session` 191/191。
- **负对照：** 本 PR 的测试跑在 base 代码上，分别有 11/33 与 9/191 失败，失败的恰好是新增的重试用例与标签钉点。
- **落地：** PR 与 main `35afa6f` 干净合并（main 改过同一个测试文件），合并后的测试文件 191/191。
- **`1dcda71` 上的 CI：** 没有失败的检查（27 个成功；其余为 skipped，另有 4 个被取消的 `route` job），包括 `Hosted process fault gates / MySQL 8.4 / Java 21`。一次绿说明不了 PR 描述引用的约 5% flake 率，证据是上面的 A/B。
- **#13276：** 它与本 PR 在两个 cli 文件上冲突（`git merge-tree`）。两者如何排期仍是 triage stage 3 留下的待决问题。

**未覆盖：**
- `restore_blocked`、`takeover_*`、`unsettled_input` 这几个标签在真实拓扑下的表现，它们只有单测钉住。`workspace_verify` 与 `file_history_pending` 在每次通过的 H 运行中都会在 IT 自身的预期拒绝上触发。
- 今天的 R1-7、R1-13、R2-x 建议。我只做了静态阅读，留给 autofix 轮次处理。
- macOS 与 Windows。
- MariaDB。
- 自然发生率的 A/B。以我的运行次数，发生率太低。


### 复现

- **各臂**（daemon 运行的是 `<root>/dist/cli.js`，所以每一臂都需要独立的 root）：
  - A = 在 `9915c7f` 建 worktree，然后 `pnpm install --frozen-lockfile`、`npm run build`、`npm run bundle`。
  - T = A 加上 `git show 1dcda71:packages/cli/src/serve/hosted-harness-session.ts`，再执行 `node esbuild.config.js && node scripts/copy_bundle_assets.js`，放在独立 root 中。
  - M = 在 H 的 `withRetry` 里、`!retryable ||` 上方插入 `true || // VERIFY MUTANT`，然后在 core 执行 `tsc --build` 并重新打包。bundle 中对应代码为 `if(true){…`。
  - H = 在 `1dcda71` 建 worktree 并全量构建。
- **钩子：** 对每个 root 的 `integration-tests/helpers` 应用 `harness/patch-process.py`、`patch-driver.py`、`patch-driver-ka.py`、`patch-driver-burst.py`。它们只在设置了对应 `VERIFY_*` 变量时才生效。
- **运行：**
  - 停顿：`STALL_MS=6000 STALL_NTH=4 harness/run-it.sh <label> <A|T|M|H> <lane> VERIFY_FAULT=stall VERIFY_FAULT_AT=2`。open 阶段的读用 `STALL_NTH=1|2`，激活 commit 用 `STALL_ON=commit`。
  - 代理故障：`harness/run-it.sh <label> <arm> <lane> VERIFY_FAULT=<…> VERIFY_FAULT_AT=2`。
  - keep-alive 对照：追加 `VERIFY_PROXY_KA=65000`。
- **数据：** `data/summary.json` 每次运行一行。`data/runs-small.tar.gz` 含每次运行的 `result`、`fetch.jsonl`（probe）与 `store.jsonl`（代理）。`data/junit-failure-excerpts.txt` 是保留的失败文本，`data/ci-13339-jobs-stall-warning-census.txt` 是 CI 日志普查。
