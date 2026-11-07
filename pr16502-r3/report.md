**Verdict: merge-ready** — 47/47 scripted assertions passed, 0 failed, 0 unexecuted. Verified head `602ec7b275217fe5a95936ce00cafcb78079d7d0` (delta commit `fix(channels): drain terminal bindings outside the open watch budget` over the previously verified `82dc6abb`); base `29fa7bbe` (also the merge-base — the branch is current with `main`). The head did not move during the round.

<details>
<summary>中文摘要</summary>

**结论：merge-ready**（47/47 断言通过，0 失败）。本轮是第 3 轮跟进：上一轮判 findings 的 High 级发现（终态名额在预算内预留，重新饿死 up to 20% 的 open 绑定）已被新的 delta 提交 `602ec7b2` 修复，本轮独立复测通过。

**中心 A/B 成立（三臂）**：30 个 open + 5 个更晚绑定的终态、limit 30 的夹具下，head 拉取 30/30 open + 5/5 终态，并投递最旧 open PR（#1）的 head 变化 1 次；prev `82dc6abb` 与 base 都只拉到 25/30，排除 #1–#5，同一 head 变化 0 投递。上一轮那条承重证据在本 head 上翻正。

**扇出代价被精确计量，且与描述一致**：终态排出名额现在在 open 预算之外（上限 20%，至少 1）。30 open + 5 终态时线级扇出为 35、30、30（积压清空即回落）；生产形态 94 open + 148 终态时峰值 36/轮（= 30 + ceil(30×0.2)），148 个终态在 25 轮内全部排出，尾部回落到 30/轮，且 28 轮里 open 覆盖始终 30/30。边界也测了：limit 1（2、2、1）、无终态（30）、open 不足限额（6 然后 2）、`prWatchLimit` 以字符串 `"5"` 给出时回退默认（10/10 被观测，即默认 30 生效）。

**回归面未破损**：公共 turn 期间 2400ms 内完成 43 次轮询、公共 turn 只执行 1 次且并发恒为 1；first-contact body 在「settle 早于游标提交」的故障注入下仍然投递（上一轮记录的 race 未回归）。

**变异矩阵**：4 行 3 杀。正对照（同文件内已知被钉住的 `MAX_PR_WATCH_LIMIT`）1 条测试变红，证明 runner 确实收集该文件；把修复回退成预算内预留 → 4 条测试变红（含作者新增的验证夹具）；删掉终态名额 → 4 条变红。唯一存活是相邻的 `terminalSlots = max(reserve, leftover)` 行：它不由本 delta 改动，删除后 642 条测试全绿——实测其后果是 open 远低于限额时终态只能按 6/轮 排出而非填满剩余预算（变异构建 8 vs head 12），属**覆盖缺口**（行为正确、无测试钉住），非缺陷，列为 Suggestion。

**未覆盖**：cli 描述符/注册表套件、Web Shell 编辑器 + i18n 套件、真实 `qwen serve` E2E 未在本轮重跑（作者报告为 49/49、145/145、26/26）；上一轮用于归因 body 闸门的 `mutgate` 臂本轮未重建（该机制本轮未改动，head 与 prev 均投递）。

</details>

## Previous findings at this head

| # | finding | severity | status at `602ec7b2` | evidence |
| --- | --- | --- | --- | --- |
| 1 | The in-budget terminal reservation re-starved up to `ceil(limit*0.2)` open bindings and permanently swallowed their head changes | High | **fixed** | 30/30 open + 5/5 terminal observed, oldest open PR's head change delivered (1) vs prev/base 25/30 and 0; the author's new unit test is the same fixture and goes red when the fix is reverted |
| 2 | PR description still described the removed first-contact body gate | Medium | **fixed** | The body now says "The first-contact issue body feed is NOT gated" and explains the runner-FIFO serialization that replaced the gate; the stale paragraph is gone from both languages |

Round-2 "not covered" items re-measured where feasible: `prWatchLimit` supplied as a JSON string is now measured at the adapter boundary (falls back to the default budget: 10/10 bindings observed with `"5"` configured). The CLI descriptor suites, Web Shell editor/i18n suites and the real `qwen serve` E2E remain unrun locally (see _Not covered_).

## Central claim and A/B

The delta's central claim: open bindings keep the **full** `prWatchLimit`, and terminal-pending bindings drain in an **additional** slice outside it (`min(terminal, max(1, ceil(limit*0.2)))`, plus any leftover open budget), so draining the dead set never excludes a live PR.

Harness: `pr16502-r3.mts` drives the real `GithubChannel` source with a real `Octokit` over a local GitHub-compatible HTTP stub. Doubles are limited to the agent bridge and the bound-session delivery service. Each arm imports its own tree: `readlink -f node_modules/@qwen-code/channel-base` resolves into `trees/{base,prev,head}/packages/channels/base` respectively (the first setup attempt got this wrong — all three resolved to a shared `trees/packages` — and this assertion caught it before any cell was measured).

Fixture: 30 open bindings (PR #1 oldest … #30 newest) plus 5 terminal-pending bindings bound **more recently**, at the default limit 30.

| cell | oracle | head `602ec7b2` | prev `82dc6abb` | base `29fa7bbe` |
| --- | --- | --- | --- | --- |
| open bindings observed in poll 1 | `GET /pulls/N` count | **30/30** | 25/30 | 25/30 |
| terminal-pending bindings observed in poll 1 | `GET /pulls/N` count | **5/5** | 5/5 | 5/5 |
| head change on the oldest open PR (#1) | `deliverPrompt` to its bound session | **1 delivery** | 0 | 0 |
| cap warning | stderr `not watched:` | absent (35/35 watched) | `#1…#5` (open) | `#1…#5` (open) |

All four cells are in `01-ab-fix.png`, printed by the live runs behind the numbers.

## Fan-out while the dead set drains

The additive slice is a deliberate cost, and it is the one new risk this delta introduces. Measured at the wire (every `GET /pulls/<n>` a poll issues, not the selection's own idea of what it watched):

| shape | per-poll fan-out | claim |
| --- | --- | --- |
| 30 open + 5 terminal, limit 30 | 35, 30, 30 | limit + slice while draining, back to limit after |
| 94 open + 148 terminal, limit 30 (PR body's production shape) | peak **36**/poll; all 148 terminal bindings drained inside the 28-poll window; tail 30, 30, 30 | bounded by `limit + ceil(limit*0.2)` = 1.2x, then returns |
| 2 open + 4 terminal, limit 30 | 6, 2 | leftover budget goes to terminal; never exceeds the limit |
| 3 open + 2 terminal, limit 1 | 2, 2, 1 | reserve is at least one even at limit 1 |
| 35 open + 0 terminal, limit 30 | 30 | the slice invents no work when nothing is terminal-pending |

Across 28 production-shape polls, open coverage was 30/30 in every poll. The descriptor, Web Shell i18n (EN/ZH), user guide and both design docs state the 1.2x bound and the ~69-open figure at a 5000 req/h budget; the arithmetic is self-consistent (5000/60 ≈ 83 watched PRs, 83/1.2 ≈ 69 open).

The loop is sequential and aborts the whole pass on a shared credential/rate-limit failure, so the extra 6 requests per poll do not create a new concurrency hazard; the 1.2x is visible in the rate arithmetic an operator reads.

Secondary (unchanged by the delta, re-measured at head): during a public turn the poll loop completed **43 polls** in the 2400 ms window with exactly one public turn and `maxConcurrentPrompts = 1`; the settle-before-cursor-commit body race still delivers the first-contact body.

## Mutation matrix

Baseline green through the exact runner before any mutant: 642/642 at `602ec7b2`. Every anchor matched exactly once; each mutant was restored with `git checkout HEAD --` plus a clean-diff assertion; the positive control lands in the mutated file.

| row | mechanism | outcome | witness |
| --- | --- | --- | --- |
| `control_limit_ceiling` | `MAX_PR_WATCH_LIMIT` 500→499 (known-pinned clause, same file) | KILLED 1/642 | clamps an over-ceiling prWatchLimit to the hard ceiling |
| `m1_in_budget_slice` | the delta reverted: `slice(0, limit - terminalReserved)` | KILLED 4/642 | the new fixture plus the three selection/headroom/tiering tests |
| `m2_no_terminal_slice` | `terminalReserved` forced to 0 | KILLED 4/642 | same four tests |
| `m3_no_leftover_budget` | `terminalSlots = terminalReserved` (drops the leftover budget) | SURVIVED 0/642 | see Suggestion below |

The new test (`keeps every open binding observed while newer terminal bindings drain`) fails for the right reason under `m1`: `expected [ 6, 7, …, 35 ] to deeply equal [ Array(35) ]` — it observes only the 30 newest open bindings, not a compile or import error. `02-mutation-matrix.png` is the matrix as it printed.

## Gates

- GitHub package at head: **684/684** (adapter file **642/642**); prev adapter 641/641; base adapter 621/621. Counts match the PR body's claims.
- `tsc --build` on `packages/channels/github` at head: exit 0.
- ESLint on the five changed source files: 0 errors. Gate liveness proven by planting `debugger;` (reported as `no-debugger`) and `: any` (reported as `@typescript-eslint/no-explicit-any`), then restoring the tree clean.
- Prettier `--check` on the five changed files plus the three docs: clean. Liveness proven by planting an unformatted line (reported) and restoring.
- Design docs: 14 headings each in EN and ZH, reciprocal language links present, the `1.2x` claim appears 3× in each language. Web Shell i18n carries the updated description in both EN and ZH.

## Suggestion — the leftover-budget branch has no test (pre-existing, not load-bearing)

`terminalSlots = Math.max(terminalReserved, limit - watched.length)` is not changed by this delta (it predates it), and no committed test pins the leftover half: both leftover-budget tests use at most 4 terminal bindings, below the 20% reserve of 6, so removing the leftover still leaves 642/642 green. Adjudicated by running the mutant build rather than by reading it: with 2 open + 10 terminal at limit 30, head issues **12** `pulls.get` in poll 1 (2 open + 10 terminal, no cap warning) while the mutant issues **8** (2 open + 6 terminal, warning lists `#901…#904`) and then 6 in poll 2. So the branch is live, the head behaviour is correct, and the gap is coverage only: a fixture with `terminal > ceil(limit*0.2)` and `open < limit` would pin it.

Reproduce:

```bash
cd tmp/pr16502-verify-20261107-182923
node_modules/.bin/tsx pr16502-r3.mts --arm head --scenario fanout-leftover-large
node_modules/.bin/tsx pr16502-r3.mts --arm mut3 --scenario fanout-leftover-large   # mutant build
```

## Not covered

- **CLI descriptor mirror/registry suites (author: 49/49), Web Shell editor + i18n suites (author: 145/145), and the real `qwen serve` E2E (author: 26/26)** were not re-run locally. The adapter package is built and its suites run; the changed descriptor/i18n text is verified by diff and by the EN/ZH parity check, not by those suites.
- **The round-2 `mutgate` arm** (prev head + the removed body gate restored) was not rebuilt, so this round re-measures only that the race is *not* regressed at head and prev (both deliver). The gate-removal attribution itself stands from round 2 and was not re-derived.
- **`prWatchLimit` through the management API / settings store** (type coercion at the store boundary) is not measured; only the adapter getter's string fallback is.
- macOS/Windows local runs, and the mobile/Java lanes, are untouched by this delta and not run.
- The one surviving mutant is reported above as a coverage gap, not as a PR defect.

## Methodology

macOS host, Node 24.18.1. Three detached worktrees under the artifact dir (`trees/{base,prev,head}`, plus `trees/mut3` for the survivor adjudication), each with a minimal `node_modules/@qwen-code` symlink directory so internal packages resolve per arm and bare dependencies fall through to the enclosing checkout; `packages/channels/base` was built per arm with `tsc --build --force` (exit 0 in all four, realpath assertions quoted above). Harness scenarios, per-cell logs (`ledger-logs/`), the mutation ledger (`mutations.json`), the assertion ledger (`assertions.json`) and the capture transcripts live beside this report. `scripts/verify-pr-guard.mjs` compared the PR's reviews and comments before publishing: clean, head unchanged.