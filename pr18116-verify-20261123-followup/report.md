# PR 18116 verification (follow-up round) — feat(web-shell): support session-required Skills menus

**Verdict: `merge-ready`** — 20 executed assertions passed, 0 failed, at head `8910584f2d` (unchanged since the previous round; PR parent `19b6174`, live base tip `36fc21f5`, two commits ahead of the branch). The central claim holds in a three-arm A/B — head `8910584f2d` / parent base `19b6174` / trial merge onto `36fc21f5`: with `skillsRequireSession`, opening the Skills menu prepares one session without submitting a prompt, reads that session's supported commands, shows its Skills, migrates the draft **including attachments**, and stale reads for a replaced session never populate the new composer. Without the option none of the new path runs, and the workspace catalog is used instead.

This round re-measured both findings from the previous round at the same head and added four probes the first round did not run: a stale-result navigation race, the error→recovery path, attachment migration through the new menu-time entry point, and the SDK response-shape cross-check. Both prior findings still stand; neither blocks.

<details>
<summary>中文摘要</summary>

**结论：`merge-ready`**（20 项断言全部通过，0 失败；验证 head `8910584f2d`，与上一轮相同；父提交 `19b6174`，主分支基线 `36fc21f5`）。

**三臂对照**（head / 父提交 base / 合入主分支后的试合并树）结果一致：启用 `skillsRequireSession` 后，打开 Skills 菜单只创建 1 个会话（不提交消息），读取该会话的 supported commands（2 次，会话身份切换前后各一次，PR 说明已注明未优化），显示会话 Skill，并把草稿**连同附件**迁移到新会话；准备期间切换会话时，旧会话的迟到结果不会写入新输入框；读取失败会显示错误，重新打开可恢复。未启用该选项时，创建 0 个会话、读取 0 次会话命令，仍走工作区目录（1 次读取）。

**上一轮发现复核（同一 head，结论不变）**：
1. 默认路径（未启用选项）挂载自定义页脚时，切换会话会多一次工作区 Skills 读取（head 1→2，base 1→1）。本轮重新测得 head extraReads=1、base extraReads=0、合并树 extraReads=1。非阻塞。
2. 本 PR 未新增测试：`skillsRequireSession` 在 head 上仅出现在 `App.tsx`（生产代码）与本轮临时验证文件中，仓库既有测试 0 处引用。建议补回归测试。非阻塞。

**本轮新增验证**：附件随草稿迁移（上一轮只验证了文本）；准备期间切换会话的迟到结果丢弃；命令读取失败后的恢复；SDK `DaemonSessionSupportedCommandsStatus` 字段与代码读取一致（`sessionId`/`availableSkills`/`availableCommands[].input.hint`）；PR 补丁可无冲突应用到 `36fc21f5`，且合并树上四个 App cell 与 head 完全一致。

**未覆盖**：未接真实 `qwen serve`/HTTP 线（使用仓库 App 测试的 workspace client 替身）；未跑 web-shell 全量 typecheck/lint；未在真实浏览器/macOS/Windows 验证；首次初始化延迟、worker 就绪、服务端权限不在本 PR 范围。

</details>

## Central claim and A/B

The PR's central claim: on a fresh composer whose host sets `skillsRequireSession`, opening the Skills menu prepares the composer's session through the existing creation flow, reads that session's commands, shows them, migrates the draft, and the first prompt reuses that session — with no prompt submitted by the menu.

| arm | tree | role |
| --- | --- | --- |
| HEAD | `8910584f2d` (PR head) | the change |
| BASE | `19b6174` (PR parent) | control that differs only by the PR |
| MERGED | `36fc21f5` (live base tip) + `git apply -3` | landing state; applied cleanly, no conflicts |

The cells are scripted assertions in a scratch copy of the repository's own App test harness and composer DOM harness; raw rows are appended by the harness and reproduced below.

| cell | HEAD | BASE | MERGED |
| --- | --- | --- | --- |
| A. first menu on a fresh composer | create=1, supported reads=[`session-9`,`session-9`], workspace reads=0, prompts=0, menu skills=[`session-skill`], error=false, draft-assignment callback=`session-9` | create=0, supported reads=[], workspace reads=1, prompts=0, menu skills=[`workspace-skill`] | identical to HEAD |
| B. session replaced while the read is pending | stale read started; after switching to `session-2`: skills=[`fresh-skill`], `stale-skill` absent, error=false, reads=[`session-9`,`session-2`] | create=0, supported reads=[], skills=[] | identical to HEAD |
| C. command read fails, then reopen | error shown, then recovered: skills=[`session-skill`], error=false, create=1, prompts=0 | no session path: error=false, create=0 | identical to HEAD |
| D. default path + custom footer, session switch | workspace reads 1→2 (extraReads=1), list=[`workspace-skill`] | workspace reads 1→1 (extraReads=0) | extraReads=1 |
| E. menu-time draft retention (composer) | method present; text=`menu-prep draft`, images=1, session attachment key=true, pending key=false | method absent → cell red | not run (composer harness measures the API the PR adds; head/base is the decisive pair) |
| F. control: plain session switch | text lost (`''`), images=0, pending key kept, session key absent | same | not run |

Cell A also pins the two behaviours the PR body claims: the menu submits no prompt (`sendPrompt` and `sendDetachedPrompt` both 0), and the App passes the allocation callback into the composer (the handle received `session-9`). Cell B pins the ownership guard: the late payload for `session-9` is dropped after the composer moved to `session-2`. Cell C pins failure recovery. Cell E pins the Reviewer Test Plan's "preserve the current draft and attachments" through the **new** menu-time entry point; cell F is the control showing the same switch without that entry point loses the draft, so E's retention is attributable to the PR.

A/A note on build inputs: `packages/core`, `packages/acp-bridge` and `packages/sdk-typescript` are byte-identical between `8910584f2d` and `36fc21f5` (empty `git diff --stat`), so their built `dist/` trees were shared by the arms — no PR-touched package's build output crossed arms. `packages/web-shell` was never built or copied between arms.

## Previous-finding status (same verified head)

| # | previous finding | status this round | evidence |
| --- | --- | --- | --- |
| 1 | Default path + custom footer: a session switch adds one workspace Skills read and clears the loaded list first (`skillsCatalogKey` / reset effect include `sessionId` unconditionally) | **still stands**, non-blocking | cell D: HEAD 1→2, BASE 1→1, MERGED 1→2 |
| 2 | The PR adds no tests; no test file references `skillsRequireSession` | **still stands**, non-blocking (Suggestion) | census at HEAD: the option occurs only in `packages/web-shell/client/App.tsx`; 0 pre-existing test files (the one match is this round's temporary harness, not in the PR) |

The head is byte-identical to the previous round's verified head (`8910584f2d`), so the one cell this round did not re-run — a concurrent Send sharing the pending preparation and reusing the session (previous round: create=1) — is carried on that tree identity rather than re-measured. Every other cell above was executed in this round.

## Scope and checks

- **Carried, re-executed:** menu preparation, no-prompt property, session-scoped commands, draft retention; default-path behaviour without the option.
- **New this round:** attachments through the menu-time method, stale-result navigation race, error→recovery, SDK response-shape cross-check, trial merge.
- **Cross-checked contract:** `DaemonSessionSupportedCommandsStatus` is `{v, sessionId, availableCommands, availableSkills}` with `DaemonAvailableCommand.input: {hint} | null`; the new branch reads `status.sessionId`, `status.availableSkills`, `status.availableCommands[].input?.hint`, so the shape matches the SDK type.
- **Not run:** the full `App.test.tsx` file (1592 tests) and the composer file’s full 226-test set — the round’s executed evidence is the targeted cells plus one pre-existing composer test used as a harness sanity check; a real `qwen serve` HTTP wire (the harness drives the repository's App-test workspace client), the full web-shell typecheck/lint gates, macOS/Windows, real-browser latency. The PR body already scopes out first-open latency, worker readiness, and a pre-session catalog.

## Findings

1. **Non-blocking — default path gains an extra workspace Skills read when a custom footer is mounted.** With `skillsRequireSession` absent, `skillsCatalogActive` stays true for footer hosts, and both `skillsCatalogKey` and the reset effect now include `connection.sessionId` unconditionally (`packages/web-shell/client/App.tsx:10406`, `10415`, `10618`–`10631`, the dependency at `10627`). Switching sessions therefore issues a second workspace read (HEAD 1→2, BASE 1→1) and clears the list before reloading. Scoping both to `skillsRequireSession`, or accepting the extra read in the PR text, would close it. This is a host-visible extra request, not a correctness break.
2. **Suggestion — no regression test ships with the option.** The new App wiring and the menu-time composer entry point are unpinned; the repository's existing composer tests cover only the submit-time inline assignment (`useComposerCore.dom.test.tsx`), not the new top-level method. A test that opens the menu on a fresh composer, keeps a draft (text + attachment), sends, and asserts one session is the natural place.

## Evidence and reproduction

- Raw harness rows: `rows.jsonl` — one JSON object per arm/cell, values quoted above.
- Logs: `app-head.log`, `app-base.log`, `app-merged.log`, composer runs in the same directory.
- Harness: a scratch copy of each arm's own `App.test.tsx`/`useComposerCore.dom.test.tsx` with only the mocked daemon client gaining `sessionSupportedCommands` and the mocked composer handle gaining the PR's method; the PR's production files are untouched in every arm.
- Arms: `git worktree` at `8910584f2d`, `19b6174`, and `36fc21f5` + the PR diff; `pnpm install --frozen-lockfile --ignore-scripts` per arm (same lockfile in head and base).
