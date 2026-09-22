## Maintainer 本地真实双臂验证

结论：**可以合入**。我从源码重建了两个 arm，用真实 CLI 跑真实仓库、真实 bubblewrap 沙箱和真实
大小写不敏感文件系统。Reviewer 测试计划里的每一条在 x86_64 Linux 上都复现了，只有一条不成立，
它只影响特定平台且是 fail-closed。此前 review 卡住的两项在当前 head 都已关闭。

**两个 arm。** head `6769a9cb` 对比 merge base `99bf4ce8`，各自从零跑
`pnpm install --frozen-lockfile` + `npm run build` + `npm run bundle`。Node 22.22.2、
Linux 6.12.63 x86_64、bubblewrap 0.12.0（挂进私有 mount namespace，宿主不动）。
被 review 的仓库是一次性 git 仓库 + 本地 bare remote + stub `gh`，所以
`qwen review fetch-pr` 可以完全离线端到端跑完，不碰任何共享状态。

### 1. 可信状态落在哪里

隔离 `QWEN_HOME` 下依次跑 `qwen review fetch-pr 1 acme/widget` 和 `qwen review base-tree`：

![placement](./fig1-placement.png)

head 上 `QWEN_HOME` 下只有两个文件——lease 和 base-tree 可信记录，都在
`review-state/<规范化仓库根的 sha256>` 里；仓库里根本不会再出现 `.qwen/review-leases` 目录。
`review-state` 及其每仓库子目录权限是 `drwx------`。
从 `.qwen/tmp/review-pr-1` 里启动的嵌套 review 命中**同一个**命名空间目录（一个锁作用域）；
共用一个 `QWEN_HOME` 的两个不同仓库各自独立拿到 `pr-1`，落在两个不同命名空间。
`qwen review cleanup pr-1` 会把两个文件都回收掉。

### 2. 在 workspace 里放一个伪造 lease

真正有杀伤力的是破坏性路径：会话持有一个真实的 `pr-55` lease（这样可信目录确实存在、确实被扫描），
再在 workspace 里单独放一个伪造 lease，声称 target 是 `pr-77`，但 `worktreePath` 指向另一个会话
正在用的 `.qwen/tmp/review-pr-99`。然后跑真实构建产物里的 `cleanupReviewWorktreeLeases()`。

![planted lease](./fig2-planted-lease.png)

base 采信了这个伪造文件，把另一个会话的 review worktree 删掉了；head 只删自己的 `pr-55` 树，
受害者完好。acquisition 同理：伪造 lease 在 base 上会让 `fetch-pr` 直接拒绝，在 head 上只是被
报告并替换掉。

### 3. bubblewrap 边界

![bwrap](./fig3-bwrap.png)

被 review 的代码可以写已废弃的 workspace 路径——而且这次写真的落到宿主上，这正是去掉内建 mask
的预期后果；而全局 lease、可信记录以及 workspace 之外的任何路径都返回 `EROFS`。这是以 uid 0 跑的，
所以拒绝来自挂载本身而不是文件权限。lease 在沙箱内仍然**可读**：本 PR 买到的是完整性而不是机密性，
设计文档没有过度声称这点是对的。把 `QWEN_HOME` 指进仓库内部会被直接拒绝：
`Shell sandbox workspace overlaps protected state or installation.`

### 4. 操作者配置的 mask

![masks](./fig5-masks.png)

用两个 arm 各自构建产物里的真实 `loadCliConfig()`，传入一个操作者提供的 mask：base 会追加
`<workspace>/.qwen/review-leases`，head 原样返回操作者给的列表。真实 bwrap 运行确认操作者 mask
仍然会隐藏宿主路径并丢弃对它的写入。

### 5. 从沙箱内部驱动一次 review

这个组合值得记录，因为它正是 mask 移除影响到的地方。从工具沙箱内部驱动 `fetch-pr`，
每个 arm 用它自己 `loadCliConfig` 产出的 mask 列表：

![confined](./fig7-confined-fetch.png)

base 报成功，在宿主上建出真实 worktree 和分支，然后把 lease 写进 tmpfs mask——退出即蒸发，
留下一个没人会回收的孤儿。head 直接拒绝，什么都不留。这是严格的改进，不是回归。

### 6. 大小写不敏感文件系统——唯一在 Linux 上不成立的一条

![casefold](./fig4-casefold.png)

在真实的大小写不敏感目录上（loop 挂载的 ext4，开 `casefold` + `chattr +F`），
`realpathSync.native` 返回的是调用方的写法而不是磁盘上的写法：`realpath(3)` 只规范化
`.`、`..` 和符号链接，各段的大小写原样保留。同一个目录的两种写法——`dev`/`ino` 相同——
会哈希出两个命名空间；把 `TMPDIR` 放到该文件系统上，PR 自己的用例
`shares one namespace for case variants of the same repository` 就会失败（1 failed / 29；
普通挂载上 29/29 全绿）。在大小写敏感文件系统上这个用例会在断言前 `return`，所以在 CI 跑的所有
地方它都是又绿又静默的。

可达性很窄，失败方式也良性：`getcwd(2)` 本身就返回磁盘上的写法，所以 `fetch-pr`、`cleanup` 和
会话退出时的清扫——它们都取 `process.cwd()`——都不受影响。只有调用方自己传进来的写法会劈开命名空间，
例如 `base-tree --worktree <小写>/...`，而且它是 **fail-closed** 的：
`could not establish the run's trust artifact: the review worktree lease ... could not be read ... no identity`。
没有任何东西被错误信任，也不会写出第二个命名空间，只是这一轮拿不到 base tree。

这不是合入阻塞项。要么把 Reviewer 测试计划里那句话限定到 macOS/Windows（那里
`realpathSync.native` 确实会折叠大小写），要么在文件系统证明它折叠时显式折叠——
也就是 `getProjectHash` 在 `win32` 上已经无条件做的那件事。

### 7. 对改动 hunk 的变异测试

![mutants](./fig6-mutants.png)

在 head 树上做了 9 个单 hunk 回退，用 PR 自己的测试集裁决。杀掉 7 个，存活 2 个：

- **M8** —— 把两处 `mkdirSync` 的 `mode: 0o700` 去掉，任何测试都看不出区别。这个 mode 是共享
  runner 上把别的账号挡在 lease 目录外的唯一东西，不应该能无声消失。
- **M4** —— 把「取最外层」换成「取最内层」也能存活。它只在三层嵌套时才产生分歧，因为
  `canonicalReviewRepositoryRoot` 把规则应用了两次，两遍下来双层嵌套会被折平；但
  「第一次出现的才是最外层」正是整个 re-root 存在的理由，而现在没有任何测试钉住它。

两个存活变异都被 [`suggested-tests.diff`](./suggested-tests.diff) 补上（+29 行，两个文件，
不动生产代码）。已验证：在干净 head 上全绿（88 passed | 2 skipped），加上后 M4 和 M8 都被杀掉，
Prettier 和 ESLint 干净。

### 8. 几个小点

- `nonInteractiveCli.ts` 在执行沙箱开启时会跳过 review lease 清扫——
  `if (config.getShellExecutionSandbox?.()) return;`——注释写的是
  *"Review leases live in the tool-writable workspace in this mode."*。本 PR 让这句注释不再成立，
  而这个跳过被 `nonInteractiveCli.test.ts`（"scopes review lease cleanup to the ordinary runtime"）
  钉住了。保持现状的话，在开启 `tools.executionSandbox` 的 headless 运行之前于宿主上拿到的 lease，
  退出时永远不会被回收。就算不在本 PR 处理，也值得在 Landlock 后续里回看一眼。
- 迁移说明里说旧 workspace 权威状态永远不会被导入，这是对的。值得补一句：去掉内建 mask 同时也重新
  打开了被限制代码对 `<workspace>/.qwen/review-leases` 的**写**路径——对新版本无害（根本不读），
  但同一台机器上的旧版本仍然把那个目录当权威，图 2 的 base arm 展示了旧版本拿到一个伪造文件会做什么。
- 当命名空间目录还不存在时，只读拒绝会以
  `ENOENT ... mkdir '<QWEN_HOME>/review-state/<hash>'` 而不是 `EROFS` 的形式出现——这是 Node 递归
  `mkdir` 的表现（同一路径用 `mkdir(1)` 报的是 `Read-only file system`）。日志里略有误导。
- `qwen review cleanup` 会回收 lease 和可信记录，但会留下空的
  `review-state/<hash>/` 和 `review-state/<hash>/base-tree/`——每个 review 过的仓库留一对。

### 9. 门禁

| 门禁 | 结果 |
| --- | --- |
| 本 PR 改动的 9 个测试文件 | **1012 通过，2 跳过** |
| `packages/cli` 的 `src/commands/review` + `services/review-worktree-lease` + `config` | **7299 通过，21 跳过（127 个文件）** |
| `scripts/tests/review-worktree-cleanup-workflow.test.js` | **23 个用例，11 跳过，无失败**——此前的阻塞项已关闭 |
| `npm run test:scripts` | 2579 通过，32 跳过，5 失败——**这 5 个在 base arm 上一模一样地失败**（它们断言基于 `chmod` 的拒绝，而我是 uid 0） |
| Prettier、ESLint `--max-warnings 0`、`tsc --noEmit`（core + cli） | **干净** |

两条环境说明，免得把数字读过头：`base-tree.test.ts` 在**两个 arm 上**每次都以
`[vitest-worker]: Timeout calling "onTaskUpdate"` 和非零退出码收尾——那是一个跑两分钟的文件上的
reporter RPC 超时，不是 PR 的影响；另外 PR 自己那个 case-variant 用例在所有大小写敏感文件系统上
（包括 CI）都是空跑。

此前 review 指出的重复哈希 helper 已经没有了——`getProjectHash` 从 core 引入；
`scripts/tests/review-worktree-cleanup-workflow.test.js` 现在引用 `RETIRED_REVIEW_LEASE_DIR`
并且通过。我没有重跑作者那套 aarch64 production-bundle 探针；上面的边界检查都是我自己在 x86_64 上跑的。
