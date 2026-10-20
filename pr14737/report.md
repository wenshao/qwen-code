# Local verification — PR #14737 `test(managed-agent): refuse the first FG12d release before forwarding`

**Verdict: `merge-ready` — 8/8 scripted assertions passed, 0 unexpected failures.**
Verified head `eece975198d1b552a9f350858734309b66f472b8`; base `origin/main` `ad713b7a7b2174be91b93e913dfe379aeda388d9`.
Environment: macOS + Docker (colima, linux/arm64), `maven:3.9.11-eclipse-temurin-21` + node v22.23.2, MySQL 8.0.46 container, Harness = `dist/cli.js` built from the PR tree, real Broker proxy / durable worker / stdio MCP fixture.

<details>
<summary>中文摘要</summary>

**结论：`merge-ready`**，8/8 断言行通过，0 个非预期失败。验证 head `eece9751`，base 为当前 main `ad713b7a`。

- **新格**：`firstReleaseRefusedBeforeForwardingResumesUnderTheSameId` 在真实 MySQL 8.0.46 + JDK 21 + 真实 Harness/Broker 下 **1 test / 0 failures / 20.78 s** 通过。
- **整类**：`HostedMcpRestartFaultGatesIT` **7/7，72.25 s**，`BUILD SUCCESS`，checkstyle 通过。
- **变异 A/B**（对产品 `hosted-mcp-session.ts` 注入变异后重建 `dist/cli.js`）：M2（重试换成新 id）、M3（把被拒的 release 当成已完成）、C1（分发前不落 `releasing`）**全部被新格抓红**；M1（`dispatch` 的 catch 改为直接抛出）两格都绿，属“空探针”——拒绝不是经该 catch 恢复的，而是下一次 settle 重试恢复。
- **对当前 main 的真实增量只有 1 个文件 +106 行**（GitHub 展示的 405 行是相对 merge-base，其中 #14715 的 FG12a 格已合入 main）。
- **试合并到 `ad713b7a` 干净**，无冲突。
- 未覆盖：Windows；CI 的 Hosted process fault gates 车道当时仍 pending（本报告即 approve 前的本地证据）；上述 M1 这一“格内即时恢复”的语义没有被该格钉住（Suggestion，非缺陷）。

</details>

## Central claim

The new cell must prove that a `mcp-release` **refused by the Broker proxy before forwarding** (status 503, no Runtime record) is resolved through a status lookup and **re-dispatched under the same `${configurationId}:release` operation id**, ending at `releaseState: released` with **no second configure or invoke**.

Measured at head (witness: `01-head-new-cell-and-class.png`, `logs/gate-cell1.log`, `logs/gate-class-head.log`):

| cell | result |
| --- | --- |
| new cell @ `eece9751` | 1 test / 0 failures / 20.78 s |
| whole class (6 FG12c + FG12d kill + FG12d refusal) | 7 / 7 / 72.25 s / BUILD SUCCESS |
| trial merge into `ad713b7a` | clean, +106 lines in `HostedMcpRestartFaultGatesIT.java` only (dynamic re-run hit the same boot timeout) |

## Vacuity / mutation A/B

Because the PR is **test-only** (production sources are byte-identical between main and the PR head — `git diff` over `packages/managed-agent-server` shows only the test file), the load-bearing question is whether the new cell holds down what it claims. I built four single-point mutants of the unmodified production release path in `packages/cli/src/serve/hosted-mcp-session.ts`, rebuilt the packaged Harness (`npm run build -w @qwen-code/qwen-code && npm run bundle`), and ran both the new cell and the pre-existing FG12d kill cell (`harnessKillDuringReleaseResumesTheOriginalReleaseOnMySql`) against each build. Witness: `03-mutation-matrix.png`, `02-m2-fresh-id-red.png`, `logs/mutation-ledger.txt`.

| mutant | change | new cell | old FG12d cell |
| --- | --- | --- | --- |
| M1 | `dispatch()` rethrows the rejection instead of the status-lookup fallback | pass | pass — **null probe** |
| M2 | re-dispatch mints `${configurationId}:release:retry` | **FAIL** | FAIL |
| M3 | a refused release is assumed settled (no second dispatch) | **FAIL** | FAIL |
| C1 | `releaseState: releasing` not committed before dispatch | **FAIL** | FAIL |
| clean rebuild (unmutated) | — | pass | pass (green inside the 7/7 class run; two later standalone reruns of this cell hit the `startHarness` `/capabilities` boot timeout — see _Not covered_) |

M2's failure prints the mutant on the real proxy wire, so the mutant is proven to have reached the packaged Harness:

```
ProxyCall[... kind=mcp-release, status=503, operationId=248dfff1-…:release:retry, seq=7]
ProxyCall[... kind=mcp-release, status=200, operationId=248dfff1-…:release:retry, seq=11]
```

`marker_in_bundle` in the ledger reads 0 because it greps the 14 KB `dist/cli.js` launcher; the code lives in `dist/chunks/`. The M2 wire above is the authoritative proof of propagation.

**What this shows:** the new cell is not vacuous — it fails when the retry mints a fresh operation id, when a refused release is assumed complete, and when the release state is not committed before dispatch. **What it does not show:** a mutant that the pre-existing kill cell survives while the new cell kills it. All three surviving-discriminators kill both cells, because the refusal and the kill-during-release share the same recovery code; the new cell's distinct value is the *scenario* (a refusal that never reached the Runtime, so a status lookup cannot settle it) plus its assertions on the exact same-id re-dispatch and the absence of configure/invoke.

## Findings

1. **Suggestion (coverage, not a defect): the cell does not pin in-call recovery.** M1 (rethrow instead of the in-call lookup fallback) stays green on both cells: the refusal surfaces as a thrown settle (503), and the *next* settle attempt enters `releaseState === 'releasing' → lookup → outcome_unknown → dispatch` and succeeds. The cell tolerates up to 60 settle attempts at 500 ms intervals, so a product that only recovers on a later attempt passes. If the intent is "the Harness itself resolves the refusal", a second assertion on the first `settle_resources` returning 200 (or an exact one-attempt budget) would pin it. Current behaviour is correct; only the assertion is weaker than the comment reads.

2. **Correction to the displayed diff (not a code change).** GitHub renders `gh pr diff` against the merge base, so the 405 added lines include the FG12a cells from #14715, which is already in `main`. The effective delta of this PR on current `main` is **one file, +106 lines** (`git diff origin/main pr/14737-head -- packages/managed-agent-server`). The PR body's "2/2 stacked" description is consistent with that; reviewers reading the 405-line diff should know only the new FG12d method is new to `main`.

## Not covered

- **Windows / macOS-native MySQL**: this round ran the lane's Linux container (JDK 21, MySQL 8.0.46). The Windows row stays N/A.
- **Hosted process fault gates CI lane**: it was `pending` on this head when the round ran. This report is the pre-approval local evidence; it does not substitute for that lane's Linux re-run.
- **`HostedMcpReplyLossIT` FG12a cells** shown in the GitHub diff: already merged via #14715, not re-run here (the PR's own delta does not touch them).
- **Boot flake**: two standalone reruns of the old cell (and the trial-merge arm) aborted in `startHarness` with `java.net.http.HttpTimeoutException` on the `/capabilities` probe (2 s per-request timeout) before any cell ran. The same cell is green inside the 7/7 class run on the same build, so this is attributed to the harness boot probe, not to the PR; the same flake class was recorded on #14715 (2/10 attempts). The trial-merge arm is therefore reported statically (clean merge, +106 lines in one test file, production and `dist` identical), not dynamically.
- **`M1` semantics**: the in-call recovery path is not exercised; the row is recorded as a null probe, not as a surviving defect.

## Methodology

One worktree at the PR head (`eece9751`) with a full `pnpm install --frozen-lockfile` + `npm run build` + `npm run bundle`; the packaged `dist/cli.js` is the Harness the IT spawns. Maven runs in a `maven:3.9.11-eclipse-temurin-21` container with node v22.23.2 and an isolated `-Dmaven.repo.local`; MySQL 8.0.46 runs in a sibling container, one fresh database per cell. Each gate command is `mvn -Phosted-harness-mysql -Dit.test=<cell> test-compile failsafe:integration-test failsafe:verify checkstyle:check`. Mutants are applied to `hosted-mcp-session.ts` as exact-string single edits (each anchor asserted to match once), rebuilt into `dist/`, and reverted with `git checkout --` after each row. Raw logs and harnesses: `logs/`, `harness/` in this directory.