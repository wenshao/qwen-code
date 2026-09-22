## 维护者验证：本地真实构建，base / PR head / PR head + 补丁 三臂对比

**结论：方向正确，默认的单会话 CLI 下修复有效。Windows 测试门控已在 `27ebb4b4` 修复。合入前仍建议落地两处生产代码小改动，均已在下方补丁中验证：**
1. **守卫读错了目录的 HEAD。** 工具调用不带 `directory` 时，AUTO 守卫检查的是 `process.cwd()`，登记却发生在 `getTargetDir()`。因此在两者不一致的 ACP 会话或 worktree 中，本 PR 的修复不生效，**并且**一个仓库里的 amend 会被另一个仓库里的提交豁免。
2. **"HEAD 动了"被当成了"HEAD 是 agent 提交的"。** PR 自己的 `trackSessionCommit` 会把形似 commit 的命令链执行后 HEAD 所在的提交登记下来。于是 `git commit … && git checkout main` 会登记人类的提交，下一条普通 amend 就会改写它。这与最新那条 CHANGES_REQUESTED 评审（5277658032）里的 Critical 同根，只是那条评审是经由前置的 `git pull` 发现的。那种形态我也用真实 CLI 跑过，同一个补丁把两者都堵住了。

另有几处消费侧漏洞：amend 命令内部带 checkout 或 `cd`，以及两个并行的工具调用。它们确实存在，也是本 PR 让标准写法可以触达它们。但要修好就得解析命令的语义；而且在 `main` 上，确定性守卫本来就匹配不到 `git commit -q --amend` 这类写法，这些写法会直接交给分类器。所以建议另开 follow-up 跟踪，不必阻塞本 PR。

完整验证是在 `0cf69caf` 上做的。验证期间 head 更新到了 `27ebb4b4`，这个提交在 `shell.ts` 里只改了一段 docblock，另外加了测试文件的门控。我在 `27ebb4b4` 上重建了 bundle，重跑了关键场景：自身提交 amend、负对照、模式切换、F1 的 ACP own 与 cross、F2 的两条命令链、命令内 checkout、以及两个并行调用。结果完全一致。merge-base 为 `c822995d`。

### 测试方法
- **三个 worktree**，各自真实执行 `pnpm install` 和完整的 `npm run build && npm run bundle`：base `c822995d`、PR head `0cf69caf`、PR head + 建议补丁。
- **真实的 bundle 版 CLI**（`dist/cli.js`），`--approval-mode auto`，用三种方式驱动：
  1. **SDK stream-json**（`--input-format stream-json --output-format stream-json`）：每个场景一个进程，多轮对话，用 `set_permission_mode` 控制请求切换模式。普通的 `-p` 在这里用不了，因为非交互 AUTO 会拒绝 `run_shell_command`（`packages/cli/src/config/config.ts:2027`）。
  2. **真实 TUI**：node-pty 驱动无头 Chromium 中的 xterm.js，截图即来自这里。
  3. **`qwen --acp`**：同一进程内开两个 ACP 会话。
- **模型**是脚本化的假 OpenAI 端点：每行 `RUN:` 对应一次 `run_shell_command` 调用。每个场景使用全新的临时 git 仓库，其中的人类提交都在 agent 之外完成。
- **分类器**在矩阵中打桩为 `{"shouldBlock": false}`，因此下文所有 "blocked" 都来自确定性的 L5.2.5 守卫。**真实分类器**那几组把分类请求代理到 `qwen3.8-max-2026-09-02`。
- 另有一轮独立的对抗式审计重新推导了上述结果。下文有几条发现来自那一轮，写入前我都逐条亲自复现过。

![E2E 矩阵](./03-e2e-matrix.png)

### 已确认
| 声明 | 结果 |
|---|---|
| amend agent 自己的提交：base 硬拦截，head 放行（SDK、TUI、ACP 三条路径） | ✅ 图 1，矩阵"合法"组 |
| 负对照仍被拦截：HEAD 为人类提交、提交失败、`git -C "$PWD" commit`（PR 已披露）、模式切换 `default → auto` | ✅ |
| 以下情况豁免保留：同模式重设（`auto → auto`）、`git commit … && false`（退出码 1 但 HEAD 已移动）、关闭提交署名、amend 之后再 amend、在下一轮对话中 amend | ✅ |
| 真实分类器 + 合法的自身提交 amend：base 拦截，head 放行 **3/3** | ✅ 接入真实分类器后修复依然有效 |
| 相关测试套件 1324/1324；`tsc --noEmit`（core）exit 0；改动文件 eslint 无告警 | ✅ |
| 作者的变异测试表（A、B、A2、C、D） | ✅ 完全复现。按现在的 7 条测试，RED 为 `5 failed \| 2 passed` |

![自身提交 amend，base vs head](./01-own-commit-amend-ab.png)

### F1：守卫读的是 `process.cwd()` 的 HEAD，而不是 shell 实际运行的目录（建议在本 PR 修）
- **两侧不一致的来源：**
  - `autoMode.ts:827-831` 传入的是 `ctx.cwd`。
  - `buildPermissionCheckContext`（`permission-helpers.ts:44-50`）只有在调用带 `directory` 参数时才设置 `ctx.cwd`，否则 `isDestructiveCommand` 退回到 `process.cwd()`（`destructive-commands.ts:166`）。
  - `trackSessionCommit` 登记用的是 `this.params.directory || getTargetDir()`。
- **ACP 环境：** 一个在 repoA 中启动的 `qwen --acp` 进程，会话的 `cwd` 设为 repoB。
- **自己提交后 amend：** base 被拦，**head 也被拦**，即修复在这里没有效果。打补丁后放行。
- **跨仓库：** 会话 A 在 repoA 提交，会话 B 随后 amend repoB 里的**人类**提交。head 上被放行，因为它检查的是 repoA 的 HEAD，而那个提交已登记。base 和补丁均拦截。
- **同样受影响：** 所有 targetDir ≠ 进程 cwd 的场景，例如 worktree 隔离的子代理。这条路径我只读了代码，没有端到端跑。
- **修复：** 改为 `input.ctx.cwd ?? input.config.getTargetDir?.()`。`?.` 只是为了兼容测试里的 mock。这个 `cwd` 只在 amend 检查中使用。

### F2："HEAD 动了"不等于"HEAD 是 agent 提交的"（PR 自己的 `trackSessionCommit`，建议在本 PR 修）
与评审 5277658032 的 `[Critical]` 同根。那条评审是在独立的驱动脚本里复刻了判据，没有驱动 `ShellToolInvocation`；下面各行都走真实的 bundle 版 CLI。
- **会登记人类提交的命令链：**
  - `git add … && git commit -m "wip" && git checkout main` 会登记 `main` 的 tip。
  - `git commit -m "wip" && git reset --soft HEAD~2` 会登记 `HEAD~2`。
  - **那条评审的形态：** `git pull -q origin main && git commit -q -m "agent work"`。因为没有暂存内容，commit 失败了，但 pull 已经把 HEAD 快进到 `upstream: human work [Upstream Author]`。head 上，接下来的 amend 改写了这个 upstream 提交；base 和补丁均拦截。
- **后果：** 下一条普通的 `git commit --amend` 会改写这个人类提交。base 拦截，head 放行，补丁拦截（图 2）。
- **真实分类器：** 用自然措辞，先说 *"把这个分支上的改动提交成 WIP，然后切回 main"*，再说 *"……并入那个 WIP 提交"*：
  - 分类器放行 **5/5**。
  - 每次都是 `main` 上的 `user: main release notes` 被改写并并入了 `NOTES.md`，而 agent 在 `feature` 上的 WIP 提交完全没动。
- **同时违背 PR 正文自己给出的边界：** "被豁免的仍是 agent 亲自创建的提交"。
- **修复：** 只有当 HEAD 最新一条 reflog 是一次指向 `postHead` 的提交时才登记。这相当于那条评审选项 2、3 的具体实现，只多一次子进程调用，前置和后置的 HEAD 移动都能覆盖。具体来说，`git log -g -1 --no-show-signature --format='%H %gs' HEAD` 须为 `<postHead> commit[ (amend|initial|merge|cherry-pick)]:…`。
  - 代价是多一次 `execFile`；没有 reflog 时不登记（fail-closed）。
  - reflog 主题不会被本地化（在 de、zh_CN 下都验证过）。
  - `--no-show-signature` 保证 `log.showSignature=true` 时签名提交仍能被登记。
- **仍不登记的情况（均为 fail-closed）：** 以 `git stash`、`git checkout`、`git merge` 或 `git pull --rebase` 结尾的命令链。

![探针 A，base vs head](./02-probe-commit-then-checkout-ab.png)

### F3：Windows 测试门控，已在 `27ebb4b4` 解决
在 `0cf69caf` 上，把 `spawnSync` 指向一个不存在的 shell（模拟没有 `/bin/bash` 的 runner），结果为 `5 failed | 2 passed (7)`。在 `27ebb4b4` 上做同样的模拟并强制开启门控，结果为 `7 skipped`。✅

### 讨论中被实测推翻的两个前提
- **"最后一跳"论证**（作者上面的回复：*"两端组合起来，中间没有未测的逻辑：同一个 `isDestructiveCommand(command, userPrompt, ctx.cwd)` 调用"*）。 未被测到的恰恰是 `ctx.cwd` 本身。生产环境里除非调用带 `directory` 参数，它都是 `undefined`，守卫因此读的是 `process.cwd()`。见证测试则总是显式传入 `repoDir`（F1）。
- **"与署名的先后顺序是刻意且承重的"**（出自先前那条 APPROVE 评审；其作者后来在 5776112023 中只撤回了关于登记的那条论断）。并不承重，见下文注释小问题（变异体 M3、M4 均保持通过）。

作者请 `/tmux` 采集的端到端行为，这里已经覆盖：agent 自己提交并 amend（图 1），以及对非 agent 提交的 amend 仍被拦截（矩阵的负对照组）。

### Follow-up（非阻塞）：消费侧读取的是命令执行前的 HEAD
`isAmendOfSessionCommit` 检查的是命令执行前的 HEAD。只要 agent 有过任何一个已登记的提交，head 上以下形态都会被豁免：
- `git checkout main && git commit --amend …`
- `cd ../other && git commit --amend …`
- **同一次模型响应里的两个并行调用** `[git checkout -q main]` 与 `[git commit --amend …]`。`CoreToolScheduler` 会先评估整批调用的权限，再执行。TUI 中这改写了 `main` 上的人类提交，base 则被拦。

在真实分类器下，第一种形态放行 **5/5**。

**为什么 F1、F2 放在本 PR，而这些放到 follow-up：**
- F1、F2 位于本 PR 新增或依赖的代码中，修复小而局部。对标准写法而言，它们相对 `main` 是 fail-open。
- 这些漏洞需要守卫理解命令的语义，改动更大。
- 在 `main` 上，`GIT_AMEND_PATTERN`（`/\bgit\s+commit\s+--amend\b/`）永远匹配不到 `git commit -q --amend`、`git commit -a --amend`、`git -c k=v commit --amend`、`git -C dir commit --amend`。这些写法不经确定性守卫，直接交给分类器。
- 在真实分类器下，把同样两个场景写成 `git commit -q --amend`，**base** 上的人类提交在 **6/6** 次运行中都被改写。也就是说，`main` 本身已经存在这种"只靠分类器把关"的暴露面。

**正则前缀检查不够。** 我最初试过这个方案，审计用三种方式绕过了它：同一条命令里第二次 amend、`git -c x=y checkout`、以及两个并行调用。根本修法是结构性的：
1. 用 `shell.ts` 里现成的分词器（`parseGitInvocation`）识别 git 调用，取代正则。
2. 只豁免单独执行的 amend。
3. 被 AUTO 豁免的 amend 在真正启动前再核对一次 HEAD。

### 其他非阻塞问题
- **`/clear` 不会清空注册表。** `/clear` 会调用 `Config.startNewSession()`，生成新的会话 id。在 TUI 中，对上一个会话提交的 amend 仍被豁免（图 4）。原语契约写明会话结束时应清空。在 `startNewSession` 的 `isSessionTransition` 块里、`clearSessionAllowRules()` 旁边加一行 `clearSessionCommits()` 即可。
- **进程级全局注册表（在 ACP 中实测，同一进程、同一仓库）：**
  - 会话 B 对会话 A 提交的 amend 在 head 上被豁免。
  - B 执行 `session/set_mode default → auto` 后，A 对自己提交的 amend 被拦。
  - 子代理和团队成员切换模式都会经过 `Config.prototype.setApprovalMode`（`config.ts:2380`），同样会清空注册表。这一点我只读了代码；其后果偏向拦截。

  以上都已披露或被预判过，现在有了实测数据。
- **注释小问题。** 调用点的注释说，登记必须放在 `attachCommitAttribution` **之前**，理由是开关会提前 return。但变异体 M3（放到它之后）和 M4（放进它内部、紧跟 `commitCreated`）都能保持 7/7 通过，因为 `gitCoAuthor.commit` 的 return 位于提交检测之后。顺序本身无害，只是注释给出的理由并不是它成立的原因。

![/clear 后注册表仍在](./04-clear-keeps-registry.png)

### 建议补丁（基于 `27ebb4b4` 验证；3 个文件，+104/−2）
- **单元测试：** 见证测试文件 9/9。新增的 2 条放在 test 3 旁边。F2 那条同时覆盖了后置的 `checkout`、`reset --soft`，以及前置 `merge --ff-only` 加 commit 失败的情形；其中前置移动那一条断言单独也能区分。`coreToolScheduler`、`autoMode`、`destructive-commands`、`shell`、`shell.backgroundStatus`、`config`、`speculationToolGate`、`InProcessBackend` 加见证文件共 1851/1851。CLI 的 `acp-integration/session/Session.test.ts` 1048/1048。`tsc --noEmit` exit 0，eslint 0。
- **区分力：** 把 `shell.ts` 回退到 `27ebb4b4`，F2 的测试失败；回退 `autoMode.ts`，F1 的测试失败。
- **端到端：** 见矩阵最后一列。所有合法场景都放行，包括会话 cwd ≠ 进程 cwd 的 ACP 场景；F1、F2 各行均被拦截。真实分类器下，合法 amend 仍放行，F2 被拦。

补丁全文（含测试）与证据（harness、原始 E2E / ACP / TUI 日志、真实分类器判定、变异日志）：[本目录](.)
