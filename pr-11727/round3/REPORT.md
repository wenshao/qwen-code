## Local runtime verification, round 3 — PR #11727 @ `fd61c750b0`

**Verdict: recommend merge.**

- Both findings from the earlier rounds are fixed, verified on the real CLI.
- Nothing regressed.
- The round-3 review suggestions are addressed.
- The only item left is procedural: the two `CHANGES_REQUESTED` reviews (qqqys and the review bot, both at `8ac6e4d602`) are about the Critical that is now fixed. They need a re-review or a dismissal.

Previous rounds:
- Round 1 @ `e0e63c60e5`: https://github.com/QwenLM/qwen-code/pull/11727#issuecomment-5650385612
- Round 2 @ `c2d3c24df8`: https://github.com/QwenLM/qwen-code/pull/11727#issuecomment-5652717655

### What changed since round 2

- **`88f37ebe5d`**, refactors, docs and tests:
  - The tri-state mapping is now one shared helper, `persistedOutputFilesForTruncation` (R1-1).
  - The reservation and the appends now both come from one `appendedMetadata` list plus `APPENDED_METADATA_SEPARATOR` (R3-2).
  - Doc fixes for R3-1, R3-3, R3-4 and R3-5.
  - Two new tests.
- **`fd61c750b0`**: the half-cap from round 2 §3, identical to the candidate I verified there, plus the pin test `keeps the exit-code line when the reservation would eat a sub-advisory threshold`.
- **`28e730cf8b`** is a merge of the branch into itself. The merge base is still `ee1ebcc167`, and `git diff ee1ebcc167 fd61c750b0` touches only the PR's own 9 files (+1390/−82).

### How this was tested

- **Harness:** the same one as round 2.
  - Real `qwen` CLI, headless and interactive in tmux.
  - A mock OpenAI endpoint saves the tool message exactly as it was sent to the model.
  - Real bash commands with sized output, a `TAIL-STATUS: …` line and `exit N`.
- **Builds:** head rebuilt at `fd61c750b0`. The base build is unchanged (same merge base), but every base row was re-run this round.
- **Mutant arms**, patched into the same head build and restored after every run:
  - **NOHALFCAP**: half-cap removed from the compiled `shell.js`. This reproduces the `c2d3c24df8` reservation behavior.
  - **NOCLAMP**: clamp and half-cap both removed. This reproduces `8ac6e4d602`.
- **Environment:** Linux x64, Node 22.22.2.

### 1. Both earlier findings are fixed

![critical](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/round3/02-critical.png)

- **Round-2 Critical** (c1: `truncateToolOutputThreshold: 100`, long-running command, `exit 3`):
  - NOCLAMP still delivers the **entire 148,846-char output**, so the arm is live.
  - Head delivers 1,199 chars: bounded.
- **Round-2 §3, empty preview** (c4, threshold 600):
  - NOHALFCAP reproduces round 2: 1,156 chars with neither the last line nor the exit code.
  - Head delivers 1,450 chars, **with `TAIL-STATUS` and `Exit Code: 3`**, like base.

![threshold sweep](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/round3/03-threshold-sweep.png)

**Threshold sweep.**
- From T = 600 up, head keeps the last line and the exit code on every row, as base does.
- At T = 300, head keeps the exit code but loses the last line. The body budget there is 150 chars, and that preview can't hold both.
- Fast-command controls are identical on both arms.
- NOHALFCAP in this build gives the same verdicts that round 2 measured on `c2d3c24df8`: T = 300 neither, T = 600 neither, T = 800 exit code only. The lengths differ only by a few chars of spill-file path. So the flip comes from the half-cap line alone.

In the interactive TUI (NOHALFCAP on top, head below), `Truncated part of the output:` is no longer empty:

![TUI c4](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/round3/tui-c4-nohalfcap-vs-head.png)

### 2. The window fix and the controls are unchanged

![real CLI A/B](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/round3/01-real-cli-ab.png)

Every row has the same numbers as in round 2:
- s1 whole at 28,679; s2 whole at 28,693 with exit code 3; s5 timeout whole at 28,655.
- s7b whole at 29,320; s7/s8 Shell head+tail at ~5.1k.
- The small, below-gate, far-over-budget and explicit-25000 controls are identical to base.

So the `88f37ebe5d` refactor doesn't change behavior on the real CLI. Key rows re-run a second time matched.

### 3. Review of the `88f37ebe5d` refactor

- **Tri-state helper:** the same semantics at all three call sites (success, combined, timeout). Both non-trivial arms are pinned: mutating `[file]`→`[]` (M11) and `[]`→`undefined` (M11b) each fails a test.
- **Unified append loop:** the attribution warning's TUI-display append moved inside `typeof llmContent === 'string'`.
  - In `execute()`, `llmContent` is always a string: it starts as `''` and the formatted body is `[…].join('\n')`. So nothing changes today.
  - The comment above the loop already documents the `Part[]` caveat.
- **Null checks:** `.filter((s) => s !== null)` replaces the old truthiness checks. Neither the advisory nor the warning can be an empty string, so the two are equivalent.
- **Docs:**
  - The half-cap rationale is in both languages.
  - The new `2026-08-10-tool-output-offload-preview.zh-CN.md` has the same heading structure as the English doc (7/7), with reciprocal links.
  - Invariant 5 now scopes the combined pass to the success path.
  - The Non-goals budgets match the source: agent 32,000; web-search 100,000 + 2,000; MCP 500,000.

### 4. Tests

![tests and mutants](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/round3/04-tests-mutants.png)

- **Head:** **759 passed**.
- **Counterfactual** (the PR's test files against merge-base production code): **13 fix-dependent tests fail**. That's round 2's 11 plus the two new reservation pins.
- **Mutation probes: 14 of 17 killed.**
  - M1 (≈ `8ac6e4d602`) and M1b (≈ `c2d3c24df8`) are both killed, so each earlier finding now has a test that catches it.
  - M13, the round-2 survivor (`attributionWarning` left out of the reservation), is now killed by `reserves the appended attribution warning out of the body budget`.
  - M1c survives but is equivalent: with the half-cap, `T − min(r, ⌊T/2⌋) ≥ 1` for any `T ≥ 1`, so the clamp can no longer fire. It is harmless defense.
  - M12 survives but is equivalent today: only Shell sets the marker, and Shell always declares a budget.
  - M2b survives. Dropping the 2-char separator from the reservation math is unpinned, a ≤ 4-char drift. Optional, low value.

### 5. Residuals (not blocking)

- **The failure hook still re-arms the gate:** s2 plus a `PostToolUseFailure` hook gives a 2,498-char stub on both arms. The autofix loop moved this design question to its follow-up queue.
- **Timeout-path hook context is bounded only by the aggregate batch budget:** base 52,460 vs head 78,657 with a 50k `additionalContext`. This existed before the PR and is now documented in invariant 5.

### Merge checklist

- **CI on `fd61c750b0`:** every required check green (Test, Lint & Static, Integration no-AK, web-shell E2E, Desktop Shell); `review-pr` pending.
- **Reviews:** `reviewDecision` is `CHANGES_REQUESTED`, from qqqys and from the review bot at `8ac6e4d602`. Both are about the Critical that §1 shows is fixed, so they need a re-review or a dismissal.
- **Recommendation:** merge.

### Not covered

- Linux only.
- I didn't trigger the attribution-warning half of the reservation on the real CLI; that needs a `git commit` whose attribution note write fails. It is now pinned by a unit test that catches M13.
- Spawn and setup failures: unit control test only, as in earlier rounds.

Figures, harness and raw per-run summaries: https://github.com/wenshao/qwen-code/tree/asserts/pr-11727/round3
