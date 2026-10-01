## 维护者验证第 2 轮（仅增量）：PR #12650 @ `0f8f1756`

**合并参考结论：** 与 `de0f9143` 上的[第 1 轮](https://github.com/QwenLM/qwen-code/pull/12650#issuecomment-5853242337)相同。**代码可以合入**，**PR 元数据还不行**。本轮在**原生 x86_64** 装置上重新验证当前 head。第 1 轮跑在 qemu 下，钉定的 shellcheck 在那里无法执行。本评论只覆盖第 1 轮没有覆盖的内容。

- **代码：✅ 已在当前 head 重新验证。** 自 `de0f9143` 以来，PR 自身的提交只有一个重构（`ad4ceab8`）和两个纯测试提交（`bd9bcfc3`、`83807551`），其余都是从 `main` 合入。
  - CI 实际执行的 shell 与第 1 轮验证的版本**逐字节一致**，只有一处 stderr 文案不同。
  - `getLinterPath()` 在 linux、darwin、win32 和无参调用下输出完全相同。
  - #12647 触发条件下，本 PR 仍会把 shellcheck 的假绿变成响亮失败。
  - **本轮新增：** 如果 #12648 自己的 `safe.directory` 步骤软失败，本 PR 就是兜底。这正是 #12647 关闭之后本 PR 仍保有的价值。
  - 健康代码树上，装置的 **2324 条 shellcheck finding 与当前 head 真实 CI 作业逐行一致**。
  - 测试套件 16/16 通过。变异测试杀掉 14/18。4 个存活体我都在真实通道里实测过，均不阻塞合入。
- **元数据：❌ 仍未更新。** 标题、正文和 `Fixes #12647` 仍在描述第 0 轮的设计：yamllint 版本探测加 PATH 重排。这套设计不在代码树里。[autofix 评论 5868718857](https://github.com/QwenLM/qwen-code/pull/12650#issuecomment-5868718857) 中可直接套用的标题和正文在当前 head 下依然成立。我逐条核对了其中可检验的说法：16 个测试（原有 6 个 + 新增 10 个）、全部十处行号引用、`ctx.skip()` 门槛，以及两个无门槛的 `getLinterPath` 用例。套用前需要改一处：它的 macOS 那句说 `de0f9143` 之后新增的用例都是 `getLinterPath` 测试，实际上是一个 `getLinterPath` 默认值用例加一个 yamllint 退出码通道用例（`:366`）。所以 16 个用例里有 2 个从未在 macOS 上跑过，那一格应为 ⚠️，或者在句子里写明。autofix 循环已在 10/10 暂停，且没有 GitHub 凭证，所以需要有写权限的人来套用。
- **建议路径：**
  1. 套用这份标题和正文，其中已去掉 `Fixes #12647`。
  2. 驳回只针对元数据的 `CHANGES_REQUESTED`（[最新一条](https://github.com/QwenLM/qwen-code/pull/12650#pullrequestreview-5372546130)）。
  3. 合入。

  第 5 节的 shellcheck 退出码残留是既有问题，更适合作为后续跟进处理。

### 环境

| | |
| --- | --- |
| 装置 | `catthehacker/ubuntu:act-latest`（Ubuntu 24.04.4），在 x86_64 宿主上**原生 amd64** 运行。`/bin/sh` = dash，git 2.55.0，GNU xargs 4.9.0，file 5.45，Node 22.22.2。镜像预装了 yamllint 1.35.1，因为当前 head 的 CI 没有打印 `Installing yamllint...`。我去掉了镜像自带的系统级 `safe.directory=*`。 |
| 触发条件 | 作业以 `root` 身份运行，`HOME=/root`。工作区是 `/home/github-runner/actions-runner-hk3-13/_work/qwen-code/qwen-code`（即跑当前 head CI 的那台 runner），属主 `github-runner`（uid 1001）。 |
| 代码树 | PR head `0f8f1756` 的代码树，真实 git index 中有 10252 个受跟踪文件。`main` 臂用的是同一棵树，只把 `scripts/lint.js` 换成 merge-base `afb911a3` 的版本；head 减 base 正好是 PR 的两个文件。`lint.js`、`lint.test.js`、`ci.yml` 在今天的 `main`（`27a4485d`）上都没有变化，PR 可以干净地合入。 |
| 通道 | 真实的 `node scripts/lint.js --setup / --actionlint / --shellcheck / --yamllint`，每条都用工作流的 `bash -eo pipefail` 运行。`--setup` 通过 lint.js 自己带 SHA-256 校验的缓存路径安装 actionlint 1.7.12 和 **shellcheck 0.11.0 `linux.x86_64`**。因为本机代理下载极慢，我预置了归档，其 SHA-256 与钉定值一致。argv 记录垫片放在通道 PATH 最前面，`exec` 真实二进制，并统计 linter 调用次数。 |
| 宿主测试 | Debian 13 x86_64（dash），vitest 3.2.7 |

### 1. 当前 head 下的 #12647 触发条件

![触发条件 A/B](01-trigger-ab.png)


| 通道 | `main` | PR |
| --- | --- | --- |
| `Run shellcheck` | **exit 0，假绿**：shellcheck 以 0 个文件被调用 | 0.03 s 内 **exit 1**，shellcheck 从未被调用 |
| `Run yamllint` | exit 1，但失败在 `FILE_OR_DIR - is required` 上 | 0.03 s 内 **exit 1**，yamllint 从未被调用 |

PR 下，git 自己的 `fatal: detected dubious ownership …` 紧挨在通道的 `git ls-files failed; refusing to lint an empty file list` 上方。

### 2. 新增：#12648 的步骤软失败时会怎样

![safe.directory 软失败 A/B](02-safe-directory-softfail-ab.png)


#12648 在 `Restore workspace ownership` 里加的 `safe.directory` 那一行以 `|| echo "::warning::…"` 结尾，所以它失败时作业会继续。我把这个步骤从 `ci.yml` **原样**拿来，在只读 `$HOME` 下运行。它打印了 `could not lock config file … Read-only file system` 和 `::warning::`，然后 exit 0。随后两条通道都撞上 dubious ownership：

- `main`：shellcheck 同样假绿，yamllint 同样失败在 usage 页面上。
- PR：两条响亮失败，都点名 git 的报错。

所以本 PR 为 #12648 自身的失效模式兜底。

### 3. 健康路径、与真实 CI 对照、重构增量、测试

![一致性、重构、测试](03-parity-refactor-tests.png)


- **一致性：** 我先运行上述原样步骤，它添加了 `safe.directory`。之后每个臂都是**一次 shellcheck 调用检查 66 个脚本**、**一次 yamllint 调用检查 78 个文件**。两臂都 exit 0，`main` 与 PR 的 stdout 和 stderr **逐字节一致**。一个重复键的 YAML 文件在两臂上都让 yamllint 失败，`::error` 行相同。
- **装置与真实 runner 一致。** 当前 head 的 [Lint & Static 作业](https://github.com/QwenLM/qwen-code/actions/runs/36770735659/job/110076302069)跑在 `ecs-qwen-hk3-13` 上，日志里有 2324 条 warning、0 条 error，涉及 58 个文件。装置的 finding 与之**逐行一致**。
- **重构增量 `de0f9143` → `0f8f1756`：** 我对生成的 `shellcheck` 和 `yamllint` 通道字符串做了 diff，`check` 和 `installer` 也包括在内。唯一的变化是 YAML 空列表的提示，`refusing to lint` → `refusing to pass`。`getLinterPath()` 在 linux、darwin、win32 和无参调用下完全相同。
- **测试套件：**
  - Linux x86_64：16/16。CI 的 `Test (ubuntu-latest)`：`✓ scripts/tests/lint.test.js (16 tests)`。
  - 只对 `lint.js` 把 `process.arch` 改成不受支持的值：8 个通过、**8 个跳过**。通道用例走 `ctx.skip()`，不会失败。
  - 负对照：把 `main` 的两条通道字符串换进 PR 文件，并保留导出。恰好是 **5 个守卫测试**失败，其余 11 个通过。

### 4. 当前 head 的变异矩阵

![变异与残留](04-mutation-residual.png)


我对 `scripts/lint.js` 做了 18 个单点变异，每个都用 PR 自己的测试套件跑。**14 个被杀掉**，包括：每道守卫、`$${variable}`、`-z`→`-n`、yamllint 后加 `|| true`、`--format github` 和 `--exclude` 两个参数、awk 和 sed 改写、pip 目录顺序、`tempDir` 和 `cwd` 默认值。4 个存活体我都放进真实通道实测：

| 存活体 | 真实通道中的实测影响 | 定性 |
| --- | --- | --- |
| 去掉 `terminal-bench` 排除（`lint.js:229`） | 66 → 70 个脚本，多 22 条建议性 warning，exit 0 | 对应 bot 已暂缓的 `lint.js:229` 发现（D12-2），目前无害 |
| `platform` 默认值 → `'darwin'` | 在这台 runner 上输出与 PR 相同，因为镜像的 yamllint 在系统 PATH 上 | 仅为测试缺口 |
| `env` 默认值 → `{}` | setup、actionlint、shellcheck、yamllint **全部 exit 1**；PR 自己的 git 守卫在两条通道里都会触发 | 仅为测试缺口，失败是响亮的 |
| `runCommand` 去掉 `env.PATH = getLinterPath()` | `Run actionlint` exit 1，所以 CI 变红；但**只有 shellcheck 通道 exit 0**（`xargs: shellcheck: No such file or directory`） | 就是第 5 节的那个残留 |

这些都不阻塞合入。可选的加固是在 `defaults to the module temp dir…` 用例里加两条断言：
- `toContain(process.env.PATH)`，可以杀掉 `env` 变异体。
- 断言 `process.platform` 对应的 pip `--user` 目录，可以杀掉 `platform` 变异体。

### 5. 既有残留，原生环境复测（不是本 PR 引入）

shellcheck 通道的退出码仍然取自末尾的 `sed`。用真实钉定的 x86_64 二进制，PR 通道在三种情况下都 exit **0**：二进制缺失、二进制被换成以 SIGSEGV 退出的替身、脚本无法解析（SC1073 `error:`）。我把第 1 轮提出的[更窄候选修法](https://github.com/QwenLM/qwen-code/pull/12650#issuecomment-5853242337)重新锚定到重构后的源码上（`harness/cand.diff`），改动内容本身不变。套用后 PR 测试套件仍是 16/16。原生实测结果：

| 场景 | PR | 候选修法 |
| --- | --- | --- |
| 二进制缺失 | exit 0 | exit 1（xargs 127） |
| SIGSEGV 替身 | exit 0 | exit 1（xargs 125） |
| 无法解析的脚本 | exit 0 | exit 1 |
| 额外一条 SC2086 warning | exit 0 | exit 0 |
| 健康代码树 | exit 0 | exit 0，stdout **逐字节一致** |

这适合放在后续跟进里处理。第 1 轮提到的另一处残留在当前 head 的真实 runner 上也仍然存在：`Run sensitive keyword linter` 步骤 34 ms 结束、没有任何输出，因为 `lint.js` 没有处理 `--sensitive-keywords` 的代码。

### 未覆盖 / 装置说明

- **本轮没有重跑 macOS**（宿主是 Linux）。第 1 轮在 `de0f9143` 上用 macOS arm64 跑过，14/14。此后通道 shell 逐字节未变。之后新增的两个用例都没有在 macOS 上跑过：yamllint 退出码通道用例（桩 exit 1，xargs 返回任何非零状态都能通过）和 `getLinterPath` 默认值用例。
- **没有在 Windows 上实际执行。** 8 个通道用例会经 `ctx.skip()` 跳过，上面的不支持架构模拟走到了这条路径。两个 `getLinterPath` 用例用 `toPosix` 归一化路径，我只做了推理。本 PR 的 CI 里 `Test (macos-latest)` 和 `Test (windows-latest)` 都被跳过了。
- 这是装置，不是 ECS runner 本身。不过它在健康路径上的输出与真实 runner 逐行一致。真实 runner 镜像里的 yamllint 版本未知，装置用的是钉定的 1.35.1。

证据（截图、`REPORT.zh-CN.md`、装置 Dockerfile 和场景脚本、变异驱动、出图脚本、通道原始输出）：this directory (`harness/`, `data/`)
