## Maintainer verification — real CLI + real `typescript-language-server`, Linux

Verified head `674a0d4c12` against its merge base on `main`, `93c0d6d20d`. Both trees were built from source (`npm ci` + `npm run bundle`). Every scenario below runs the shipped `dist/cli.js` with `--experimental-lsp`. A deterministic mock model issues the `lsp` / `run_shell_command` tool calls (no real LLM), and a stdio tee in front of the language server records what the client actually delivered.

**Verdict: the fix works; recommend merge on behavior.** Seven A/B scenarios reproduce stale or false-clean answers on base and pass on the PR. They include both Criticals still standing from the human review (R4-1 reload, R4-2 failed redelivery) and the triage stage-2 orphan-`didChange` blocker. Two points are the maintainer's call before merging (D1 compatibility, D2 absent-capability policy). F1 is a small follow-up; F2 is a pre-existing bug outside this PR.

![A/B summary](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11443/fig0-wire.png)

### 1. Stale hover / definition / diagnostics after on-disk edits (#11439)

Setup: real `typescript-language-server 6.0.0` with TypeScript 5.8.3 (`textDocumentSync: 2`), one CLI session, every edit made by a separate process.

| step | base | PR |
| --- | --- | --- |
| hover, initial file | `let value: number` | `let value: number` |
| rewrite `number`→`string` (same size, mtime in the same millisecond), hover | `let value: number` ❌ | `let value: string` |
| hover again, no edit | `let value: number` | `let value: string`, no `didChange` sent |
| move the declaration to line 3, `goToDefinition` from line 4 | `No definitions found` ❌ | `src/sample.ts:3:5` |
| CRLF rewrite to `boolean`, hover | `let value: number` ❌ | `let value: true` |
| delete the opened file, `diagnostics` | `No diagnostics found` ❌ (false clean) | `LSP diagnostics failed: ENOENT` |
| hover on the deleted file | `let value: number` ❌ | `No hover information found` |
| recreate the file, hover | `let value: number` | `let value: number` (reopened) |

What the server received:
- **Base:** `didOpen v1` twice (warmup + first query), and never a `didChange`.
- **PR:** one `didOpen v1`, then `didChange` v2/v3/v4 with whole-document ranges ending at the previous text's last line (`0:0-2:0`, `0:0-2:0`, `0:0-4:0`). A read failure produces `didClose`; recreating the file produces `didOpen v5`, so versions stay monotonic. No document request is sent while the file is missing.

The same flow in the real interactive TUI:

| base `93c0d6d20d` | PR `674a0d4c12` |
| --- | --- |
| ![base hover](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11443/fig1-base-hover.png) | ![PR hover](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11443/fig1-pr-hover.png) |
| ![base definition + diagnostics](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11443/fig2-base-def-diag.png) | ![PR definition + diagnostics](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11443/fig2-pr-def-diag.png) |

### 2. Capability matrix

This uses a small stdio server that answers hover from **its own copy** of the document, so the table shows exactly what the client delivered. Columns are: after edit 1 / again / after edit 2 / again.

| `textDocumentSync` | base | PR |
| --- | --- | --- |
| `2` | v1 `alpha one` ×4 ❌ | v2 `TWO`, v2 `TWO`, v3 `THREE`, v3 `THREE` (ranged `didChange`) |
| `1` | v1 `alpha one` ×4 ❌ | same, full-text `didChange` without a range |
| `{openClose: true, change: 0}` | v1 `alpha one` ×4 ❌ | **empty**, v2 `TWO`, **empty**, v3 `THREE` → F1 |
| absent, or `{openClose: false, change: 2}` | `didOpen v1`, then stale ×4 | never opened, no orphan `didChange`; the server reads disk and answers fresh |

The `{openClose: false, change: 2}` row is the shape of triage stage-2 blocker #1 (`didChange` for a URI that was never opened). It does not reproduce at this head.

### 3. Server crash → restart → replay (`restartOnCrash: true`)

- **S3.** Open `doc.txt` and `other.txt`, kill the server, edit both, then run `workspaceDiagnostics`.
  - Base: the new process holds **no** documents, so the result is `No diagnostics found in the workspace.` (false clean).
  - PR: both files are replayed with current text before `workspace/diagnostic`, giving `2 issues in 2 files`.
- **S5 (R4-2).** Same as S3, but `doc.txt` is transiently unreadable during the first sweep (a directory takes its place → `EISDIR`).
  - PR: sweep 1 rejects with `EISDIR`, after still delivering `other.txt`. Once the file is restored, sweep 2 replays it on the new process: `2 issues in 2 files`, including `alpha RESTORED`.
  - Base: both sweeps return `No diagnostics found in the workspace.` with zero documents on the server.

### 4. `.lsp.json` reload with a pending-only URI (R4-1)

This scenario needs a harness-only patch; see F2.

**S6 steps:**
1. Open `a.txt` and `b.txt`, then crash the server.
2. Hover `a.txt` on the replacement process. This parks both files but re-delivers only `a.txt`, so `b.txt` becomes pending-only.
3. Edit `b.txt` and change an `env` value in `.lsp.json`. The reload logs `restarted=…`.
4. Before any further query, check what the reloaded process received.

**Results:**
- **PR:** the reloaded process receives `didOpen a.txt` **and** `didOpen b.txt` (with the text `bravo AFTER-RELOAD`) → `2 issues in 2 files`.
- **Base:** only `didOpen a.txt` → `1 issues in 1 files`, with `b.txt` silently missing.

A plain reload with both documents delivered (S4) replays correctly on both trees, so there is no regression there.

### 5. Call hierarchy with the new `documentRevision` token

**S7:** real tsserver; the mock echoes the prepared item verbatim from the tool's JSON section.

| step | base | PR |
| --- | --- | --- |
| prepare at `callee`, `incomingCalls` | `caller 4:17 (calls at 5:10)` | same |
| prepend 2 lines, reuse the old item | `caller 4:17 (calls at 5:10)` ❌ stale lines | `Call hierarchy item is stale or has unknown provenance; prepare call hierarchy again at a current location inside …/calls.ts` |
| prepare at line 3 (now `callee`) | `caller 4:17` ❌ wrong symbol | `callee 3:17` |
| `incomingCalls` on that item | `No incoming calls found for caller` ❌ | `caller 6:17 (calls at 7:10)` |

### Tests and static checks (Linux, Node 22.22.2)

- **Unit tests:** `vitest run src/lsp src/tools/lsp.test.ts` in `packages/core`: 9 files, **375 passed**, 2 skipped.
- **Static checks:** `tsc --noEmit` for core and cli, plus ESLint and Prettier on every changed file: all clean.
- **Mutation probes:** 12 mutants on the new sync code, each run against the same suites.
  - **10 killed:** unchanged-text skip, range end line, CRLF/CR split, parking on connection change, diagnostics error propagation, absent-capability default, version monotonicity, read-failure propagation, Full-sync range, reload snapshot union.
  - **Survived: M8.** `workspaceDiagnostics` capturing `trackedUris` *after* warmup. This is the same gap as the open R4-4 thread.
  - **Survived: M12.** A successful sweep delivery no longer clearing `replayUris`.
  - Both survivors are non-blocking test gaps.
- **CI at `674a0d4c12`:** `Test (ubuntu-latest)`, Lint & Static, Integration Tests (no-AK) and both Desktop Shell lanes pass; `web-shell E2E Smoke` was still running when this was posted. The macOS/Windows unit lanes are skipped in CI.

### Findings

**F1 — servers with `{openClose: true, change: 0}` lose one answer per edit (non-blocking).**
- *What happens:* after each disk edit, the first document query sends `didClose` and throws the unsupported-sync error. Hover and definition catch it and return empty (`No hover information found`). The next query reopens with current text.
- *Suggested fix:* by that point the fresh text has been read and the close already sent in the same call. Reopening right there (`didOpen` v+1) would avoid the false empty result.
- *Context:* base returned stale answers forever, so this is still a strict improvement.

**F2 — pre-existing, not introduced here: `.lsp.json` hot reload never restarts servers in the CLI.**
- *Cause:* `registerLspHotReload` in `packages/cli/src/llm.tsx` stores `const reinitializeLsp = runtimeConfig.reinitializeLsp;` and calls it detached, so `Config.reinitializeLsp()` runs with `this` undefined.
- *Evidence:* with `QWEN_DEBUG_LOG_FILE=1`, the log shows `Reloading LSP server settings …` followed by `LSP config change listener error: TypeError: Cannot read properties of undefined (reading 'isLspEnabled')`.
- *Scope:* identical on base `93c0d6d20d`; this PR does not touch `llm.tsx`.
- *Harness patch:* for S4/S6 only, both trees' bundles were patched identically with `?.bind(runtimeConfig)`.
- *Recommendation:* a separate one-line fix.

### Needs a maintainer decision

**D1 — compatibility.**
- *Deep imports:* the kebab-case renames remove deep-import paths that core's `"./*"` export makes reachable (`…/lsp/NativeLspService.js`, `…/lsp/LspServerManager.js`). The root export still provides the same class names.
- *Exported signature:* `LspServerManager.warmupTypescriptServer`, exported from the root, now requires a synchronize callback and returns `void`.
- *In-repo callers:* all migrated.
- *PR state:* the PR body still says it "remains a draft pending that gate", although the PR is marked ready for review.

**D2 — policy for an absent capability.**
- *Behavior change:* when `textDocumentSync` is omitted, the PR never sends `didOpen`. Base always sent `didOpen v1` and then served stale answers.
- *Protocol text:* in `vscode-languageserver-node` `protocol.ts`, `TextDocumentSyncOptions.openClose` says "If omitted open close notification should not be sent" and `change` says "If omitted it defaults to TextDocumentSyncKind.None". The top-level field states no default.
- *Assessment:* the PR's reading matches that text, unlike the premise of the stage-2 triage comment.
- *Risk:* a server that omits the capability but still expects `didOpen` would now see no document at all. No such real server was tested.

### Not covered

- macOS and Windows (URI/path handling, CRLF on a real Windows file system).
- Real non-TypeScript servers, and several servers in one sweep. doudouOUC's per-server `try` concern was checked only within a single server.
- Partial or modified `documentRevision` echoes (R3-23, R6-1).
- Memory use on large files.
- `codeActions` / `applyWorkspaceEdit`.
- Forced TypeScript warmup.

<details>
<summary>Environment / how to reproduce</summary>

- **Machine:** Linux x86_64, Node 22.22.2, `typescript-language-server@6.0.0` + `typescript@5.8.3`.
- **Builds:** one `git worktree` each for head `674a0d4c12` and merge base `93c0d6d20d`; `npm ci && npm run bundle` in both.
- **Command:** `node dist/cli.js --experimental-lsp --approval-mode yolo -p …`, with an isolated `HOME` and `OPENAI_BASE_URL` pointing at the mock model. The TUI runs use tmux.
- **Server config:** `.lsp.json` routes the real server through `typescript-lsp-tee.mjs`. The path deliberately contains `typescript`, because the server name comes from `command` and `isTypescriptServer()` matches on that string.
- **Harness and raw data:** scripts, prompts, raw JSON outputs, wire/server logs and mutation scripts are at https://github.com/wenshao/qwen-code/tree/asserts/pr-11443

</details>

<details>
<summary>中文说明</summary>

## 维护者验证 — 真实 CLI + 真实 `typescript-language-server`，Linux

验证对象为 head `674a0d4c12`，对照组为它在 `main` 上的合并基点 `93c0d6d20d`，两者均从源码构建（`npm ci` + `npm run bundle`）。下列所有场景都运行实际产物 `dist/cli.js`，并开启 `--experimental-lsp`。`lsp` / `run_shell_command` 工具调用由确定性的 mock 模型发出（没有真实 LLM）。语言服务器前接了一个 stdio tee，用来记录客户端实际下发给服务器的内容。

**结论：修复有效，从行为角度建议合并。** 7 个 A/B 场景在 base 上都复现了陈旧结果或“假干净”结果，在 PR 上全部通过。其中包括人工审查中仍未关闭的两个 Critical（R4-1 重载、R4-2 重投失败），以及 triage stage-2 提出的孤立 `didChange` 阻断项。合并前还有两点需要维护者拍板（D1 兼容性、D2 能力缺省策略）。F1 是一个小的后续改进；F2 是本 PR 之外的既有 bug。

### 1. 磁盘编辑后 hover / 定义 / 诊断陈旧（#11439）

环境：真实 `typescript-language-server 6.0.0` + TypeScript 5.8.3（`textDocumentSync: 2`），同一个 CLI 会话，所有编辑都由独立进程完成。

| 步骤 | base | PR |
| --- | --- | --- |
| 初始 hover | `let value: number` | `let value: number` |
| 改写 `number`→`string`（大小不变，mtime 在同一毫秒），再 hover | `let value: number` ❌ | `let value: string` |
| 不编辑，再次 hover | `let value: number` | `let value: string`，不发送 `didChange` |
| 声明移到第 3 行，从第 4 行 `goToDefinition` | `No definitions found` ❌ | `src/sample.ts:3:5` |
| 改写为 CRLF 的 `boolean`，hover | `let value: number` ❌ | `let value: true` |
| 删除已打开的文件，`diagnostics` | `No diagnostics found` ❌（假干净） | `LSP diagnostics failed: ENOENT` |
| 对已删除文件 hover | `let value: number` ❌ | `No hover information found` |
| 重建文件，hover | `let value: number` | `let value: number`（重新打开） |

服务器实际收到的消息：
- **base：** `didOpen v1` 发了两次（预热一次、首次查询一次），从未发送 `didChange`。
- **PR：** 只有一次 `didOpen v1`，之后是 `didChange` v2/v3/v4，全文档 range 的终点都是旧文本的最后一行（`0:0-2:0`、`0:0-2:0`、`0:0-4:0`）。读取失败时发送 `didClose`，文件重建后发送 `didOpen v5`，版本号保持单调递增。文件缺失期间不发送任何文档请求。

真实交互式 TUI 中的同一流程见上方图 1、图 2。

### 2. 能力矩阵

使用一个小型 stdio 服务器，它用**自己保存的文档副本**回答 hover，因此能直接看到客户端实际下发了什么。各列依次为：编辑 1 后 / 再查一次 / 编辑 2 后 / 再查一次。

| `textDocumentSync` | base | PR |
| --- | --- | --- |
| `2` | v1 `alpha one` ×4 ❌ | v2 `TWO`、v2 `TWO`、v3 `THREE`、v3 `THREE`（带 range 的 `didChange`） |
| `1` | v1 `alpha one` ×4 ❌ | 同上，全文 `didChange`，不带 range |
| `{openClose: true, change: 0}` | v1 `alpha one` ×4 ❌ | **空结果**、v2 `TWO`、**空结果**、v3 `THREE` → F1 |
| 缺省，或 `{openClose: false, change: 2}` | 先 `didOpen v1`，之后陈旧 ×4 | 从不打开，也没有孤立的 `didChange`；服务器自己读磁盘，结果是新的 |

`{openClose: false, change: 2}` 这一行正是 triage stage-2 阻断项 #1 描述的形态（向从未打开的 URI 发送 `didChange`），在当前 head 上无法复现。

### 3. 服务器崩溃 → 重启 → 重放（`restartOnCrash: true`）

- **S3。** 打开 `doc.txt` 和 `other.txt`，杀掉服务器，编辑两个文件，然后执行 `workspaceDiagnostics`。
  - base：新进程里**没有任何**文档，结果为 `No diagnostics found in the workspace.`（假干净）。
  - PR：在发出 `workspace/diagnostic` 之前，两个文件都以当前内容重放，结果为 `2 issues in 2 files`。
- **S5（R4-2）。** 与 S3 相同，但第一次扫描时 `doc.txt` 暂时不可读（被同名目录替换 → `EISDIR`）。
  - PR：第一次扫描仍先投递了 `other.txt`，然后以 `EISDIR` 失败。文件恢复后，第二次扫描在新进程上重放了它，结果为 `2 issues in 2 files`，其中包含 `alpha RESTORED`。
  - base：两次扫描都返回 `No diagnostics found in the workspace.`，服务器上文档数为零。

### 4. 存在“仅待重放”URI 时的 `.lsp.json` 重载（R4-1）

该场景需要一个仅用于测试的补丁，见 F2。

**S6 步骤：**
1. 打开 `a.txt` 和 `b.txt`，然后让服务器崩溃。
2. 在替换进程上 hover `a.txt`。这会把两个文件都记为待重放，但只重新投递了 `a.txt`，于是 `b.txt` 成为“仅待重放”。
3. 编辑 `b.txt`，并修改 `.lsp.json` 中的一个 `env` 值。日志记录 `restarted=…`。
4. 在发出任何新查询之前，检查重载后的进程收到了什么。

**结果：**
- **PR：** 重载后的进程同时收到 `didOpen a.txt` **和** `didOpen b.txt`（内容为 `bravo AFTER-RELOAD`）→ `2 issues in 2 files`。
- **base：** 只收到 `didOpen a.txt` → `1 issues in 1 files`，`b.txt` 被静默遗漏。

两个文件都已投递时的普通重载（S4）在两棵树上都能正确重放，没有回归。

### 5. 带新 `documentRevision` token 的调用层级

**S7：** 真实 tsserver；mock 模型从工具输出的 JSON 部分原样回传 prepare 得到的 item。

| 步骤 | base | PR |
| --- | --- | --- |
| 在 `callee` 处 prepare，再 `incomingCalls` | `caller 4:17 (calls at 5:10)` | 相同 |
| 文件开头插入 2 行后，复用旧 item | `caller 4:17 (calls at 5:10)` ❌ 行号陈旧 | 拒绝，并提示 `prepare call hierarchy again at a current location inside …/calls.ts` |
| 在第 3 行 prepare（此处现在是 `callee`） | `caller 4:17` ❌ 符号错误 | `callee 3:17` |
| 对该 item 执行 `incomingCalls` | `No incoming calls found for caller` ❌ | `caller 6:17 (calls at 7:10)` |

### 测试与静态检查（Linux，Node 22.22.2）

- **单元测试：** 在 `packages/core` 中运行 `vitest run src/lsp src/tools/lsp.test.ts`：9 个文件，**375 通过**，2 跳过。
- **静态检查：** core 与 cli 的 `tsc --noEmit`，以及对所有改动文件运行 ESLint 和 Prettier：全部通过。
- **变异测试：** 针对新同步代码构造 12 个变异体，每个都跑同一组测试。
  - **10 个被杀死：** 内容未变时跳过发送、range 终点行、CRLF/CR 拆分、连接变更时保留待重放、诊断错误上抛、能力缺省默认值、版本单调、读失败上抛、Full 同步不带 range、重载快照取并集。
  - **存活：M8。** `workspaceDiagnostics` 在预热*之后*才采集 `trackedUris`。这与仍未关闭的 R4-4 线程是同一个缺口。
  - **存活：M12。** 扫描投递成功后不再清理 `replayUris`。
  - 两个存活项都是不阻断合并的测试缺口。
- **`674a0d4c12` 上的 CI：** `Test (ubuntu-latest)`、Lint & Static、Integration Tests (no-AK) 和两个 Desktop Shell 通道均通过；发布本评论时 `web-shell E2E Smoke` 仍在运行。macOS/Windows 单元测试通道在 CI 中被跳过。

### 发现

**F1 — 声明 `{openClose: true, change: 0}` 的服务器每次编辑后会丢失一次结果（不阻断）。**
- *现象：* 每次磁盘编辑后，第一次文档查询会发送 `didClose` 并抛出“不支持同步”错误。hover 和 definition 捕获该错误后返回空结果（`No hover information found`）。下一次查询才用当前内容重新打开。
- *建议：* 此时新内容已经读到，close 也已在同一次调用中发出。直接在同一次调用里重新打开（`didOpen` v+1），就能避免这次假的空结果。
- *说明：* base 会一直返回陈旧结果，因此 PR 仍然是严格的改进。

**F2 — 既有问题，并非本 PR 引入：CLI 中 `.lsp.json` 热重载从不会重启服务器。**
- *原因：* `packages/cli/src/llm.tsx` 的 `registerLspHotReload` 用 `const reinitializeLsp = runtimeConfig.reinitializeLsp;` 取出方法后脱离对象调用，导致 `Config.reinitializeLsp()` 执行时 `this` 为 undefined。
- *证据：* 开启 `QWEN_DEBUG_LOG_FILE=1` 后，日志先出现 `Reloading LSP server settings …`，随后是 `LSP config change listener error: TypeError: Cannot read properties of undefined (reading 'isLspEnabled')`。
- *范围：* base `93c0d6d20d` 上完全相同；本 PR 没有改动 `llm.tsx`。
- *测试补丁：* 仅在 S4/S6 中，对两棵树的产物做了同样的 `?.bind(runtimeConfig)` 修补。
- *建议：* 另开 PR 做一行修复。

### 需要维护者决定

**D1 — 兼容性。**
- *深层导入：* kebab-case 重命名移除了 core 的 `"./*"` 导出所能访问到的深层路径（`…/lsp/NativeLspService.js`、`…/lsp/LspServerManager.js`）。根导出仍提供同名类。
- *导出签名：* 从根导出的 `LspServerManager.warmupTypescriptServer` 现在必须传入同步回调，返回值改为 `void`。
- *仓库内调用方：* 均已迁移。
- *PR 状态：* PR 描述仍写着“等待该项确认前保持草稿”，但 PR 已标记为 ready for review。

**D2 — 能力缺省时的策略。**
- *行为变化：* 服务器未声明 `textDocumentSync` 时，PR 永远不发送 `didOpen`。base 总会发送 `didOpen v1`，之后返回陈旧结果。
- *协议原文：* `vscode-languageserver-node` 的 `protocol.ts` 中，`TextDocumentSyncOptions.openClose` 写的是 “If omitted open close notification should not be sent”，`change` 写的是 “If omitted it defaults to TextDocumentSyncKind.None”。顶层字段没有写明默认值。
- *判断：* PR 的解读与协议原文一致，与 stage-2 triage 评论的前提不同。
- *风险：* 如果某个服务器既不声明该能力、又依赖 `didOpen`，现在它将完全收不到文档。没有用这类真实服务器测试过。

### 未覆盖

- macOS 与 Windows（URI/路径处理、真实 Windows 文件系统上的 CRLF）。
- 非 TypeScript 的真实服务器，以及单次扫描涉及多个服务器的情况。doudouOUC 提出的“每个服务器单独 `try`”的担忧只在单服务器内验证过。
- 部分或被修改的 `documentRevision` 回传（R3-23、R6-1）。
- 大文件的内存占用。
- `codeActions` / `applyWorkspaceEdit`。
- TypeScript 强制预热。

脚本、提示词、原始 JSON 输出、wire/服务器日志和变异脚本：https://github.com/wenshao/qwen-code/tree/asserts/pr-11443

</details>
