## 维护者验证第 2 轮（`847e289e`，仅列增量）

第 1 轮见 [#issuecomment-5776251029](https://github.com/QwenLM/qwen-code/pull/12463#issuecomment-5776251029)。

**结论：F2 已正确修复，感谢。还有一项未解决（F1），另外 `847e289e` 给签名提交带来一个小的 fail-closed 回归。两处都很小，更新后的补丁（基于 `847e289e`，+66/−2）已全部修好，验证见下。合入该补丁后我认为可以合并；消费侧的问题仍放在 follow-up。**

我在 `847e289e` 上重建了 bundle，把第 1 轮的整个矩阵重跑了一遍，并新增一行签名提交场景。环境与第 1 轮相同：真实的 bundle 版 CLI，`--approval-mode auto`，分别经 SDK stream-json、ACP、TUI 驱动，操作真实的 git 仓库。

![第 2 轮矩阵](./05-e2e-matrix-r2.png)

### F2：已修复 ✅
这一节是对 5776726932 的补充：那条评论在独立驱动脚本里重放了判据，这里则是经真实 bundle 中的 `ShellToolInvocation` 跑的，测试套件也实际构建并运行过。
- **端到端：** 三种命令链现在经真实 CLI 都会被硬拦截：`commit && checkout main`、`commit && reset --soft HEAD~2`、`pull && <失败的 commit>`。所有合法场景仍然放行。
- **真实分类器：** 第 1 轮的探针（先提交、再 `checkout main`，然后要求"并入那个 WIP 提交"）现在还没到分类器就被拦下。合法的自身提交 amend 仍然放行。
- **静态检查：** 类型检查、eslint、prettier 均无问题。相关测试套件 7 个文件 1767/1767 通过。
- **变异测试**（针对新判据，见证测试文件共 8 条）：

| 变异体 | 结果 |
|---|---|
| N1：去掉 `createdByCommit`（退回"HEAD 动了"） | 被新增的 pull 测试杀死 |
| N2：去掉与 `preHead` 的比较 | 被 test ② 杀死 |
| N3：同时接受 `checkout` / `reset` 的 reflog 条目 | **存活** |
| N4：只拒绝 `pull` 条目 | **存活** |

新测试只覆盖了"前置移动"这一半。第 1 轮报告的"后置移动"那一半（`git commit … && git checkout main`、`… && git reset --soft HEAD~2`）没有被钉住。补丁补了一条测试，能杀死 N3 和 N4。

### 新问题：`log.showSignature=true` 时签名提交拿不到豁免（fail-closed，小问题）
`getGitHeadOrigin` 执行的是 `git log -g -1 --format=%H%n%gs HEAD`。当 `log.showSignature=true` 时，git 会把签名校验结果打印在格式化输出**之前**。下面是端到端仓库里的实际输出：

```
Good "git" signature for user@example.com with ED25519 key SHA256:…
907a3d23ebcf04582b503a06f2a1b50ec637333f
commit: agent: add feature
```

于是 `sha` 变成了 `Good "git" signature…` 那一行，`subject` 变成了 SHA，`/^commit\b/` 匹配失败。agent 自己的签名提交永远不会被登记，对它的 amend 会被硬拦截。
- **端到端（SSH 签名）：** `847e289e` 上被拦，打补丁后放行。
- **本次提交新引入：** 第 1 轮的判据用的是 `git rev-parse HEAD`，不受这个配置影响。
- **影响：** 由于是 fail-closed，对安全没有影响，但受影响的恰好是会给提交签名的那批用户。
- **修复：** 加上 `--no-show-signature`（补丁中已包含）。

### F1：仍未解决
`autoMode.ts` 没有改动，所以在 `847e289e` 上，只要调用不带 `directory`，守卫读的仍是 `process.cwd()`。我在一个从 repoA 启动的 `qwen --acp` 进程中重新测了一遍：
- `cwd` 为 repoB 的会话 amend 自己的提交：**被拦**，即修复在这里没有生效。
- 会话 A 在 repoA 提交后，会话 B amend repoB 里的**人类**提交：**被放行**。

修法与第 1 轮相同，只有一行：`input.ctx.cwd ?? input.config.getTargetDir?.()`。回退这一行，补丁里的单测就会失败。

### 与第 1 轮相比没有变化（follow-up）
以下问题在 `847e289e` 上的复现结果与第 1 轮完全一致：
- 消费侧 TOCTOU：amend 命令内部带 checkout 或 `cd`，以及两个并行调用
- ACP 下注册表是进程级全局的
- `/clear` 不会清空注册表
- 既有的正则漏配（`git commit -q --amend`、`git -C dir commit --amend`）

### 更新后的补丁（基于 `847e289e`，+66/−2）
- **`autoMode.ts`：** F1 的 cwd 回退。
- **`shell.ts`：** 加上 `--no-show-signature`。
- **测试文件，新增 2 条：** 后置 checkout/reset 测试（杀死 N3、N4），以及 target-dir 测试（回退 `autoMode.ts` 即失败）。
- **结果：** 见证测试文件 10/10；`coreToolScheduler`、`autoMode`、`destructive-commands`、`shell`、`shell.backgroundStatus`、`config`、`speculationToolGate`、`InProcessBackend` 加见证文件共 1852/1852。`tsc --noEmit` exit 0，eslint 0。
- **端到端：** 见矩阵最后一列。所有合法场景都放行，包括签名提交和 cwd 不同的 ACP 会话；负对照以及 F1、F2 各行均被拦截。

补丁全文（含测试）与证据（矩阵数据、原始 E2E / ACP / TUI 日志、变异日志、签名提交的 reflog 输出）：[本目录](.)
