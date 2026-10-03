# PR #13270 验证报告

## 维护者验证：在 `9d0ff23` 上的真实环境运行

**结论：我这边认为可以合并。** 三项修复我都是实际跑过来验证的，而不是只读 diff：
- serve-ab 的握手预算，对着真实的 `qwen serve` 守护进程跑；
- CodeQL 通报器，在真实的 GitHub Actions 上跑；
- 路由，用 GitHub 官方的表达式求值器验证，再对照池子上的实时 job 数据。

新测试在 merge-base 上会失败，20 个定向变异全部被杀死。唯一合并前看不到的是 `assign` 在池子上的运行，但它的两个运行时依赖已经在同一个池子上得到证明。

验证的 head 是 `9d0ff23f11`，包含了把 no-flicker 报告目录按 runner 隔离的那个后续提交。以下 6 个文件在 `e0cc5b6` 与 `9d0ff23` 之间逐字节相同：`serve-ab-drive.mjs`、`codeql.yml`、`codeql-failure-issue.sh`、`find-marked-issue.sh`、`sdk-java.yml`、`assign-pr-owner.yml`。因此我在 `e0cc5b6` 上针对这些文件跑出的结果依然成立。

### 1. #13266：Serve A/B 握手预算，对着真实守护进程

![对着真实守护进程验证 Serve A/B 握手预算](fig1-serve-ab-handshake.png)

- 构建 CLI（`pnpm install --frozen-lockfile` + `npm run build`，exit 0），然后用同一份构建分别跑 merge-base 版和 PR 版的 `serve-ab-drive.mjs`。本 PR 不改任何产品代码。
- 用一个 `QWEN_CLI_ENTRY` 垫片拉起**真实的** ACP 子进程，只把 `initialize` 的响应延后，其余帧原样转发。
- **merge-base 版驱动，延迟 15 秒：**`channel exited (… signal=SIGKILL …)`、`AcpSessionBridge initialize timed out after 9989ms`、`504 init_timeout`。与 #13266 的 CI 日志逐行一致（那边是 9988ms）。
- **PR 版驱动：**
  - 延迟 15 秒和 55 秒都通过。
  - 延迟 65 秒时失败，报 `timed out after 59989ms`。说明参数确实传到了守护进程，而且预算仍然是有限的。
  - 子进程真的卡死时，每条腿的代价从约 10 秒变成约 60 秒，因为驱动在第一个 setup 步骤失败时就停止（实测 61.3 秒）。
- **抓取结果：**
  - PR 版驱动，无延迟对比延迟 15 秒：12 个场景里 0 个字段变化。
  - merge-base 版对比 PR 版：只有 `activeWorkStaleMs` 3→4。同一个 merge-base 驱动连跑两次也是 3→4，所以这是计时噪声。本 PR 上 serve-ab 机器人评论的全部内容也就是这个字段（4→6），所以那条评论并不代表响应真的变了。

### 2. #13249：CodeQL 通报器在真实 GitHub Actions 上的表现

![在真实 GitHub Actions 上验证 report_failure](fig2-codeql-fork-probe.png)

- **探针设置：**在我 fork 上的一个孤儿分支。
  - `codeql` 矩阵保留 PR 的 job 名模板、`fail-fast: false` 和每条腿的 `timeout-minutes: '${{ matrix.timeout }}'`。用 sleep 代替分析，让 javascript 腿超过上限。
  - `report_failure` 与 PR 逐字节一致，只在 `if:` 里做了两处声明过的改动：仓库换成 fork，`schedule` 换成 `push`。
  - 探针专用步骤只拦截 `gh issue create/comment`，所有读取都是真实的。
- **有一条腿超时的那次运行：**
  - 该腿结束为 `cancelled`（`##[error]The operation was canceled.`），`needs.codeql.result` 读到的是 `cancelled`。
  - 由于 `always()`，`report_failure` 照样运行。
  - 用真实的 `gh` 2.101.0 和该 job 的 `actions: read` token，未改动的脚本写出了 `Legs: CodeQL (javascript): cancelled`，并调用了 `gh issue create … --label type/bug --label scope/ci-cd`。
- **两条腿都通过的那次运行：**`report_failure` 被跳过。另有一份 job 原样保留 PR 的 `if:`，两次运行里都被跳过。
- **GitHub 官方求值器**（`@actions/expressions` 0.3.61）对 PR 原样的 `if:`：只在 `QwenLM/qwen-code` 上 `schedule` × {failure, cancelled, skipped} 时运行。24 个上下文全部一致。
- **开 issue 这一步在生产中已经跑通过。**ECS 机群通报器用 workflow token 走的是同样的步骤：`find-marked-issue.sh`、`gh issue create --label type/bug --label scope/ci-cd`、`gh issue comment`。`github-actions[bot]` 开了 #11633，之后都在它下面评论，而没有重复开新 issue。
- 用 `GITHUB_TOKEN` 创建的 issue 不会触发 `issues` 事件的 workflow，所以 triage 和 autofix 都不会接手这些 issue。

### 3. #13245：迁移的几条 lane

![迁到 ECS 池的几条 lane](fig4-ecs-lanes.png)

- **路由：**用 GitHub 官方求值器对 4 个原样的 `runs-on` 表达式跑了 1,440 个上下文：
  - 上游仓库或 fork 仓库；
  - 5 种总开关取值；
  - 所有触发事件；
  - 同仓 head 或 fork head；
  - 8 种作者关联。

  1,440 个全部符合声明的策略，包括 `'TRUE'` 这个取值（表达式里的 `==` 不区分大小写），以及 `assign` 的 `pull_request_target`。
- **在 `9d0ff23` 上：**
  - `Serve A/B` 跑在 `ecs-qwen-hk5-12`，`Flyway` 跑在 `ecs-qwen-hk4-14`，都是绿的。
  - 作者的手动触发把两个 tui-parity job 放到了 `ecs-qwen-hk5-20` 和 `-16`，都是绿的。
  - `assign` 仍跑在托管 runner 上，符合预期。
- **最近 40 次 tui-parity 运行的排队时间（2026-10-03，03:31–12:23Z）：**
  - 托管（74 个 job）：中位数 8.1 分钟，p90 20.7 分钟，最长 38.6 分钟。
  - ECS（4 个 job）：3–4 秒。
  - 12:28Z 的机群：93 个 `ecs-qwen` 注册，全部在线，24 个忙。
- **共享主机检查：**
  - 针对 `9d0ff23`，我在同一台机器上同时跑了两次真实的离线 no-flicker gate，各用一个 runner-temp 风格的 `OUT`。两次都报 `base-fails-fixed-passes` / PASS，各自写出自己的 11 个报告文件，`/tmp/opentui-noflicker-out` 下没有任何写入。
  - `setup-bun` v2.2.0 写的是共享的 `/home/github-runner/.bun`。我读了它的源码：版本匹配时复用现有二进制，否则用原子 `rename` 安装。所以同一台主机上的两个 job 不会把对方的 bun 弄坏。
  - 工作区被复用时，Flyway 的 `git clean -ffdx` 约 4 秒，整个 job 18 秒。

### 4. 新测试真的钉住了改动吗？

![负向对照与变异矩阵](fig3-tests-mutants.png)

- **PR head：**node 99/99；vitest 234/234（codeql、sdk-java、workflow-size）。
- **把 PR 的测试拷到 merge-base 上：**node 失败 19 个（其中一个是 serve-ab 套件在导入时就失败：没有 `INITIALIZE_TIMEOUT_MS` 导出），vitest 6/14 失败。
- **变异：**我对 PR 的生产代码做了 20 个单行改动，测试全部抓到，未改动的副本通过。这些改动包括：
  - 把门改回只认 `failure()`；
  - 去掉 `always()`；
  - `assign` 守卫 `pull_request` 而不是 `pull_request_target`（这会让 fork 进池子）；
  - 把属主恢复挪到 checkout 之后；
  - 把预算改回 10 秒；
  - 新加的 `OUT` 固定值的两种破坏方式。
- **其他检查全部通过：**
  - 仓库锁定版本的 actionlint 1.7.12（`scripts/lint.js --actionlint`）；
  - shellcheck；
  - prettier `--experimental-cli`；
  - `check-workflow-size.sh`。
- **完整的 `HELPER_TESTS` 和 `test:scripts`：**仅有的失败在 merge-base 上同样失败。它们是不相关套件里的权限类测试，以 root 身份运行时无法通过。
- **合进当前 `main`（`576689d073`）：**合并干净，改动涉及的套件和 size ratchet 都通过。

### 未验证项与备注（均不阻塞）

- **`assign` 在池子上的运行合并前无法观测**，因为 `pull_request_target` 读取的是 `main` 上的 workflow。
  - 它的路由已由上面的求值器检查覆盖。
  - 它的运行时依赖已在同一个池子上得到证明：`node` 由 Flyway lane 证明，`gh` 由 `ecs-qwen-hk4-9` 上 Serve A/B 的 merge-base 步骤证明。
  - 如果想在合并前跑一次，下面这条命令会走 ECS 路由，且 dry-run 路径只读：`gh workflow run assign-pr-owner.yml --ref ci/13245-13249-13266-ci-fixes -f number=13270 -f dry_run=true`。
- 两个早于本 PR、不在其范围内的问题：
  - serve-ab 评论把 `activeWorkStaleMs` 报成变化，但它是计时噪声，可以在 `serve-ab-diff.mjs` 里归一化。
  - 两次 ECS 手动触发都打印了 `QWEN_API_KEY not set — running offline scripted-stream gate`，所以目前 CI 跑不到 no-flicker gate 的真实模型分支。

证据（图、`REPORT.zh-CN.md`、harness、原始日志）：本目录

### 复现

- `harness/serveab/slow-acp-shim.cjs` + `harness/serveab/run-arm.sh <arm> <serve-ab-drive.mjs> <hold-ms>`：真实守护进程 A/B（需要已构建的 `packages/cli/dist`）。结果与日志在 `data/serveab/`。
- `harness/probe/gen.py`：从 PR 的 `codeql.yml` 文本重新生成 `harness/probe/.github/workflows/*.yml`；单独推到 fork 的孤儿分支上即可。job 日志在 `data/probe/`。
- `harness/eval-routing.mjs <worktree>`：用 GitHub 官方求值器（`npm i @actions/expressions@0.3`）求值原样表达式。输出在 `data/eval-routing.out`。
- `harness/mutants.py`：20 个变异加对照。输出在 `data/mutants-r2.json`。
- `harness/noflicker-two-runners.sh`：两个并发的离线 no-flicker gate，各用按 runner 隔离的 `OUT`。
- 排队统计：`data/census/`。
