## Maintainer verification, round 5 (delta) — PR #12531 @ `0a5e943bf1`

**Verdict: mergeable from my side. The round-4 blocker is closed and I have no blockers left.** I re-ran everything on the real PR head (fresh `pnpm install --frozen-lockfile`, `npm run build`, `npm run bundle`, no local patches). What remains is the human review gate below.

This is a delta over [round 4](https://github.com/QwenLM/qwen-code/pull/12531#issuecomment-6011313566). Anything round 4 measured that is not listed here is unchanged.

### What changed since round 4

- `cdb3cb189e` is byte-identical to candidate E. I diffed each of the four files against my round-4 cand E worktree.
- `0a5e943bf1` merges `main` `43a6e1e5e4`, which is the same `main` my round-4 `merge` arm was built on. Its tree equals that arm (`7e489a5b33` + `43a6e1e5e4`) plus candidate E and nothing else: `git diff --stat` between the two lists only the four files, +55/−13.

### Results at `0a5e943bf1`

| Check | Result |
| --- | --- |
| Real CLI `qwen -p`, 83 scenarios | Identical to round-4 head + cand E on all 83 rows. Against the round-4 head, exactly the 10 fail-open rows changed (N2–N4, N6–N11, N14), each back to `main`'s verdict. |
| ACP `qwen --acp`, 9 scenarios | N2, N7, N8, N9, N14 return `Tool "…" is disabled.`; N3 and N10 raise a permission request. Both match `main`. P1 and E1 are unchanged from round 4. |
| Real interactive TUI, N8 and N2 | Blocked with `Matching deny rule`; the MCP server logged 0 calls (Fig 1, Fig 2). |
| Module differential, 16,502 rule × tool rows | 0 losses against `main` on deny, ask, `isToolEnabled` and subagent `disallowedTools` (round-4 head: 152). 0 rows differ from round-4 cand E. |
| Against `main`, all 83 rows | One row runs where `main` blocks: A5, the PR's declared narrowing (a `foo.bar` entry no longer blocks server `foo_bar`). 17 rows that run on `main` now ask or are blocked: the #10199 fixes, plus P4 below. Same set as round 4. |
| Unit tests | Core targeted suites: 2924 passed, 7 skipped (35 files; up from 2854 because the merged `main` adds tests). Collision suite 101/101. CLI ACP `Session.test.ts` 1152/1152. Red-first and mutation results carry over from round 4 because the code is byte-identical (8/8 new rows red on `7e489a5b33`, 5/5 mutants killed); the author's red-first count (8 failed, 93 passed) matches. |
| CI at `0a5e943bf1` | Test (ubuntu-latest), Lint & Static, Integration (no-AK), Desktop Shell and TUI parity all pass. Test on macOS and Windows was skipped by routing. Both `review-pr` runs (and their `fallback-comment` jobs) failed before reviewing anything: the bot token got `HTTP 403: Sorry. Your account was suspended`. That is infrastructure, not this PR. `web-shell E2E Smoke` was still running when I posted. |
| Current `main` (`481b4837aa`, 2 commits ahead) | `git merge-tree` is clean. The two commits touch the XML tool-call fallback and the memory dream, nothing under permissions or MCP naming, so I did not build a separate arm. |

![Fig 1: N8 before and after](./01-tui-n8-raw-key-fixed.png)

![Fig 2: N2 before and after](./02-tui-n2-underscore-tool-fixed.png)

![Fig 3: round 4 to round 5](./03-r4-to-r5-delta.png)

### Still open, not blocking (unchanged from round 4)

- **R23-1.** E1 (a legacy exact `allow` while a same-spelling server is registered) still grants, which is what `main` does. The design doc's `:36` sentence still promises a refusal.
- **R26-1.** P3 (agent-local competitor) behaves like `main`. P4 (an agent-local owner now gets a prompt) is a fail-closed UX regression.
- As the bot points out on both threads, #13412 does not list these rows yet. E1 and P3/P4 should be added there when this merges, so the follow-up is actually tracked.

### Merge gates

- `pomelo-nwu`'s `CHANGES_REQUESTED` from `952e3ef668` (2026-09-25) still stands, so `reviewDecision` is `CHANGES_REQUESTED`.
- `chiga0`'s approval on `7e489a5b33` was dismissed by the new push, so it needs a fresh approval at `0a5e943bf1`.

**Not covered:** Windows and macOS (Linux x86_64 only), App-only RPC/UI, external model providers, the `tool_search` bridge. Same limits as round 4.
