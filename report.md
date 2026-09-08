# Maintainer verification — local build + real test execution

Verified on a dedicated worktree at the PR head `daf3d6d97d`, fresh `npm ci` (Linux, Node v22.22.2, npm 10.9.7) — same Node major as the failing CI lane. Every number below comes from a real run on this machine; nothing is taken from the description.

**Verdict: recommend merge.** The fix is correct, minimal, and — with the second commit — non-vacuous. Two documentation nits below, neither blocking.

---

## 1. The failure reproduces exactly, and it is the *whole* failure

Restoring only `App.test.tsx` from `70cf363395` (the commit #11404 reports) and running the two tests reproduces the CI error verbatim at `App.test.tsx:28940`:

![base red](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11406/fig1-base-red.png)

Running the **whole** web-shell suite at that content gives numbers byte-identical to CI job `102182712398`:

| | CI @ `70cf363395` | Local, same content | Local, PR head |
|---|---|---|---|
| Test Files | 1 failed \| 287 passed (288) | 1 failed \| 287 passed (288) | **288 passed (288)** |
| Tests | 2 failed \| 6710 passed (6712) | 2 failed \| 6710 passed (6712) | **6712 passed (6712)** |

![parity](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11406/fig6-parity.png)

This closes the PR's own "not validated" caveat: the red run contained **no** other failures — the two `does not rerender App for other split sessions` cases were the only red tests in the only red suite of the only red job. `Fixes #11404` is exact, not approximate.

It is also still live. Five other open PRs currently have a red `Test (ubuntu-latest, Node 22.x)` for this same `ReferenceError` (#11397, #11396, #11392, #11369, #11360), so this is blocking merge signal repo-wide, not just `main`'s own lane.

## 2. PR head is green

![pr green](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11406/fig2-pr-green.png)

## 3. The assertions bite — 7 mutants, all behaving as predicted

![mutants](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11406/fig3-mutants.png)

| Mutant | Result | Where it reds | What it proves |
|---|---|---|---|
| *(control)* PR head, unmutated | 2 passed | — | baseline |
| delete `rerender()` | **2 failed** | the `toHaveBeenCalled()` guard | the guard now measures that render — the acceptance criterion from round 1 is met |
| delete `rerender()`, **on commit 1 only** | 1 failed / 1 passed | the loop, guard stays **green** | reproduces the round-1 finding: without commit 2 the guard cannot fail |
| commit 1 only, unmutated | 2 passed | — | commit 1 alone already clears the red; commit 2 is a strictness fix, not a correctness prerequisite |
| delete the **trailing** `mockClear()` | 2 failed | the loop | the trailing clear is load-bearing, not redundant |
| added clear → `mockReset()` | 2 failed | `TypeError: Cannot destructure property 'hasActivePrompt'` | it must be `mockClear`, never `mockReset` |
| **production:** drop `useDaemonSessionActivityBridge(...)` from App's render body | 2 failed | the guard | the guard is bound to the real hook App calls, not to test scaffolding |
| **production:** make every pending-panes report toggle `outerSplitPanePending` | 2 failed | the loop | the negative assertions genuinely detect an App rerender |

Instrumenting the spy confirms the mechanism numerically. Before commit 2 the guard was reading 6–7 accumulated setup-time calls; after it, exactly the 1 call made by the render it claims to observe:

![census](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11406/fig4-census.png)

## 4. Post-merge safety

`packages/web-shell` is **unchanged** between this PR's base and current `main` (`1f890086f1`), the merge is conflict-free, and the merged `App.test.tsx` blob hashes identically to the file I tested — so the local green above *is* the post-merge state, not an approximation of it.

## 5. How this reached `main` (context, not a defect in this PR)

Worth recording, because the PR is right that its own sandbox could not determine it:

![escape](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11406/fig5-escape.png)

1. #11250's branch was **green and correct**: at its head `52484fecf3` the mock was declared, wired into the module mock, and named `mockUseDaemonActivePromptBridge`.
2. 51 minutes later #11267 landed on `main` and renamed the hook and its mock to `useDaemonSessionActivityBridge` / `mockUseDaemonSessionActivityBridge`.
3. The squash-merge took `main`'s renames *and* #11250's three new lines. Textually clean, semantically broken — a classic semantic conflict.
4. No static gate can see it: `packages/web-shell/tsconfig.json` excludes `client/**/*.test.tsx`, so `npm run typecheck` exits 0 on the broken file, and `eslint` exits 0 too (`no-undef` is explicitly off for this file — verified with `eslint --print-config`). Only *running* the test catches it.
5. `ci.yml` has no `push` trigger and — per its own header comment — the merge queue is not enabled, so nothing re-validated the squashed tree — the after-the-fact main-failure watcher (#11404) was the first thing to notice.

The systemic fix (a merge queue, or typechecking test files) is out of scope here; this PR is the right immediate repair.

## 6. Non-blocking nits before squash

1. **The description is stale relative to the second commit.** It still says "a three-line, test-only edit" and describes the fix purely as repointing three assertions; the diff is +5/−3 and the added `mockClear()` — the change that actually makes the guard capable of failing — is not mentioned anywhere in the body. Since this squashes into one commit message, the body is worth a one-line update.
2. **The "Not validated / out of scope" bullet can be struck.** It says whether the red run contained unrelated flaky failures "cannot be determined from here". It can: it did not — §1 above.

<details>
<summary>中文说明</summary>

# 维护者验证 —— 本地构建 + 真实运行

在 PR head `daf3d6d97d` 的独立 worktree 上、全新 `npm ci`（Linux，Node v22.22.2，npm 10.9.7，与失败的 CI 车道同一 Node 大版本）完成验证。下列所有数字均来自本机真实运行，未采信 PR 描述。

**结论：建议合并。** 修复正确、最小，且在第二个提交加入后不再是空断言。文末两条仅为文档层面的小问题，均不阻塞。

---

## 1. 失败可精确复现，且它就是全部失败

仅把 `App.test.tsx` 还原到 `70cf363395`（#11404 所报的提交）再运行这两个测试，逐字复现 CI 的报错，位置 `App.test.tsx:28940`（见上方第一张截图）。

在该内容上运行**整个** web-shell 套件，结果与 CI job `102182712398` 完全一致：

| | CI @ `70cf363395` | 本地同内容 | 本地 PR head |
|---|---|---|---|
| Test Files | 1 failed \| 287 passed (288) | 1 failed \| 287 passed (288) | **288 passed (288)** |
| Tests | 2 failed \| 6710 passed (6712) | 2 failed \| 6710 passed (6712) | **6712 passed (6712)** |

这填补了 PR 自述的"未验证"缺口：那次红色运行中**没有**其他失败——两个 `does not rerender App for other split sessions` 用例是唯一红色 job 里唯一红色套件中唯一红色的测试。`Fixes #11404` 是精确的，不是近似的。

问题目前仍在扩散：另有 5 个其他开放 PR（#11397、#11396、#11392、#11369、#11360）的 `Test (ubuntu-latest, Node 22.x)` 正因同一个 `ReferenceError` 变红。它阻塞的是全仓库的合并信号，而不只是 `main` 自己的车道。

## 2. PR head 全绿

两个目标测试通过；整套 web-shell 套件 288/288 文件、6712/6712 测试通过（见上方第二张截图）。

## 3. 断言确实有效 —— 7 个变异体，全部如预期

| 变异体 | 结果 | 变红位置 | 说明 |
|---|---|---|---|
| *(对照)* PR head 未变异 | 2 passed | — | 基线 |
| 删除 `rerender()` | **2 failed** | `toHaveBeenCalled()` 守卫 | 守卫现在确实度量该次渲染——第 1 轮评审提出的验收标准已满足 |
| 删除 `rerender()`，**仅在第 1 个提交上** | 1 failed / 1 passed | 循环处，守卫仍**绿** | 复现第 1 轮的发现：没有第 2 个提交，守卫不可能失败 |
| 仅第 1 个提交，未变异 | 2 passed | — | 仅靠第 1 个提交即可消除红色；第 2 个提交是严格性修复，而非正确性前提 |
| 删除**后置**的 `mockClear()` | 2 failed | 循环处 | 后置清空是承重的，并非冗余 |
| 新增的清空改为 `mockReset()` | 2 failed | `TypeError: Cannot destructure property 'hasActivePrompt'` | 必须是 `mockClear`，绝不能是 `mockReset` |
| **生产代码：** 从 App 渲染体中移除 `useDaemonSessionActivityBridge(...)` | 2 failed | 守卫处 | 守卫绑定的是 App 真正调用的 hook，而非测试脚手架 |
| **生产代码：** 让每次 pending-panes 上报都翻转 `outerSplitPanePending` | 2 failed | 循环处 | 负向断言确实能检测到 App 的重渲染 |

对 spy 的插桩计数从数值上印证了机制：第 2 个提交之前，守卫读到的是 6–7 次挂载期累积调用；加入之后，恰好只有它声称观察的那次渲染所产生的 1 次调用（见上方第四张截图）。

## 4. 合并后的安全性

本 PR 的 base 与当前 `main`（`1f890086f1`）之间，`packages/web-shell` **没有任何改动**；合并无冲突；合并树中 `App.test.tsx` 的 blob 哈希与我实测的文件完全一致——因此上面的本地绿色结果**就是**合并后的状态，而不是对它的近似。

## 5. 它是怎么进入 `main` 的（背景信息，非本 PR 的缺陷）

值得记录，因为 PR 确实说明了它自己的沙箱无法判定这一点：

1. #11250 的分支本身是**绿色且正确的**：在其 head `52484fecf3` 上，该 mock 已声明、已接入模块 mock，名字是 `mockUseDaemonActivePromptBridge`。
2. 51 分钟后 #11267 合入 `main`，把该 hook 及其 mock 重命名为 `useDaemonSessionActivityBridge` / `mockUseDaemonSessionActivityBridge`。
3. squash 合并同时采纳了 `main` 的重命名**和** #11250 新增的三行。文本上无冲突，语义上已损坏——典型的语义冲突。
4. 没有任何静态门禁能发现它：`packages/web-shell/tsconfig.json` 排除了 `client/**/*.test.tsx`，因此 `npm run typecheck` 在损坏文件上退出码为 0，`eslint` 同样为 0（该文件的 `no-undef` 被显式关闭——已用 `eslint --print-config` 核实）。只有真正**运行**测试才能捕获。
5. `ci.yml` 没有 `push` 触发器，且据其文件头注释合并队列亦未启用，因此没有任何环节复验 squash 后的树——最先发现的是事后的主干失败监测（#11404）。

系统性修复（启用合并队列，或把测试文件纳入类型检查）不属于本 PR 范围；本 PR 是正确的即时修复。

## 6. squash 前的两条非阻塞小问题

1. **描述相对第 2 个提交已经过时。** 正文仍写着"仅三行、仅测试文件的改动"，并把修复完整描述为"重新指向三处断言"；而实际 diff 是 +5/−3，且新增的 `mockClear()`——真正让守卫具备失败能力的那处改动——在正文中完全没有提及。由于这会 squash 成单条提交信息，正文值得补一句。
2. **"未验证 / 超出范围"那一条可以删掉。** 它写的是"红色运行中是否还包含无关 flaky 失败，从这里无法判定"。是可以判定的：没有——见上文第 1 节。

</details>
