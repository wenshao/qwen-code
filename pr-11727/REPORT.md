## Local runtime verification, round 2 — PR #11727 @ `c2d3c24df8`

**Verdict: the round-3 Critical is fixed and the original fix still works. On behavior this is merge-ready once the two `CHANGES_REQUESTED` reviews are cleared.**

- I reproduced qqqys's Critical on the real CLI with the code as of `8ac6e4d602`: **148,846 chars of raw output reached the model**. At `aee22dfbfd` the same run is bounded at 1,151 chars.
- The default-config window from #11729 stays fixed, and every control scenario delivers the same length as the merge base.
- One new, narrow side effect of the reservation is described in §3, with a one-line fix verified on the real CLI. It is not blocking.

Previous round, at `e0e63c60e5`: https://github.com/QwenLM/qwen-code/pull/11727#issuecomment-5650385612

### How this was tested

- **Build:** two worktrees, each with its own `npm ci` and build: PR head `c2d3c24df8` and merge base `ee1ebcc167`. `git diff ee1ebcc167 c2d3c24df8` is exactly the PR's 8 files (+961/−31).
- **CLI:** the real `qwen` CLI, run both headless (`-p --approval-mode yolo`) and interactive in tmux.
- **Mock model:** a mock OpenAI endpoint issues one `run_shell_command` call and saves the tool message exactly as it was sent to the model. It then replies with a one-line summary of that message, so the same verdict also shows up in the TUI.
- **Third arm, NOCLAMP:** the head build with `Math.max(1, …)` removed from the compiled `shell.js`. This matches the code qqqys reviewed:
  - `git diff 8ac6e4d602 aee22dfbfd -- packages/core/src/tools/shell.ts` is exactly that clamp.
  - The `main` merge between those commits touches none of `shell.ts`, `coreToolScheduler.ts`, `tools.ts` or `truncation.ts`.
  - The patch is applied per run and restored afterwards; I checked the restore after every batch.
- **Commands:** real bash that prints N fixed-width rows, then a `TAIL-STATUS: …` line, then runs `exit N`.
  - "Slow" commands wait past half of a 6 s per-call timeout, which triggers the long-run advisory.
  - "Timeout" commands block on `tail -f /dev/null` under a 4 s timeout.
- **Environment:** Linux x64, Node 22.22.2. I re-ran the key rows (r2) and they matched r1 exactly.

### 1. The window fix still holds at head

![real CLI A/B](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/01-real-cli-ab.png)

- **Window rows (s1 succeeds, s2 fails, s5 times out):** base sends the model a 2.5k head-only stub. Head sends the whole body, including the tail and the exit code. Timeouts have no exit code by design.
- **Behavior change since round 1, by design:** in the 637-char advisory band (s7, s8), `e0e63c60e5` delivered ~30.3k whole.
  - Head now truncates in-tool to Shell's own 5.1k head+tail preview. The R1-2 reservation is what makes the marked string fit the 30k budget.
  - The tail, the exit code and the advisory still arrive.
  - A body that fits under the reservation (s7b) still arrives whole: 29,320 chars.
- **Controls, identical on both arms:** a small output, output below the gate, output far over budget, a timeout far over budget, and an explicit `truncateToolOutputThreshold: 25000`.

The same s2 run in the interactive TUI. Base (top) gives a head-only `<persisted-output>` stub. Head (bottom) gives the whole result, ending in `Exit Code: 3`.

![TUI s2](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/tui-s2-base-vs-head.png)

### 2. The round-3 Critical: real on `8ac6e4d602`, fixed by `aee22dfbfd`

![critical A/B/C](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/02-critical-abc.png)

- **c1** (`truncateToolOutputThreshold: 100`, slow command, `exit 3`):
  - NOCLAMP delivers **148,846 chars, the entire raw output**.
  - Head delivers 1,151 chars; base delivers 1,251.
  - The interactive TUI shows the same thing: 148,846 on NOCLAMP vs 1,137 on head.
- **The failure path was the only unbounded one:**
  - The success path (c2) is bounded on every arm.
  - A fast failure (c3) is bounded too: no advisory fires, so nothing is reserved.
- **Tests:** the new pin test `keeps a sub-advisory explicit threshold from disarming the pass it marks` catches the NOCLAMP code (mutant M1 in §4).

![TUI c1](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/tui-c1-8ac6-vs-head.png)

### 3. New: at small explicit thresholds the reservation starves the preview (non-blocking)

![threshold sweep](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/03-threshold-sweep.png)

**Mechanism.** The clamp keeps the body bounded, but `bodyBudgetChars = Math.max(1, outputThreshold - appendedMetadataChars)` can still spend the whole budget on the 637-char advisory reservation.

- `previewChars` is `Math.min(4000, bodyBudgetChars)`, so a threshold of 600 leaves a **1-char preview**.
- The model then receives only the truncation header and the advisory: no command, no rows, no exit code.
- Base, with the same settings, delivered head+tail including `Exit Code: 3`.

**Sweep** (slow command, `exit 3`):

| Explicit threshold | Base | Head |
| --- | --- | --- |
| 300, 600, 700 | tail ✓ · exit code ✓ | tail ✗ · exit code ✗ |
| 800 | tail ✓ · exit code ✓ | tail ✗ · exit code ✓ |
| 1,000 and above | tail ✓ · exit code ✓ | tail ✓ · exit code ✓ |

- Controls with a fast command at T = 600 and T = 1,000 are identical on both arms. That isolates the reservation as the cause.
- At these sizes the reservation can't reach its goal anyway: the truncation header alone is ~510 chars, so head delivers 1,151 chars against a 600-char threshold regardless.

![model view c4](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/05-model-view-c4.png)

In the TUI, `Truncated part of the output:` is followed by nothing:

![TUI c4](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/tui-c4-base-vs-head.png)

**Scope.** This needs an explicit `truncateToolOutputThreshold` under ~1k plus a foreground command that runs at least half its timeout. The default configuration is unaffected.

It is still the exit-code loss this PR exists to prevent. The new pin test passes on it because it asserts only three things: the sentinel is present, the raw body is gone, and a spill file was recorded.

**Candidate fix, verified.** One line in `shell.ts`, the same line as the clamp: reserve at most half the threshold.

```ts
const bodyBudgetChars = Math.max(
  1,
  outputThreshold -
    Math.min(appendedMetadataChars, Math.floor(outputThreshold / 2)),
);
```

![candidate fix](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/06-candidate-fix.png)

Results on the real CLI with this change:

- **T = 600:** tail ✓ and `Exit Code: 3`.
- **T = 800:** tail ✓ and exit code.
- **T = 300:** exit code ✓, tail ✗.
- **T = 100 (the Critical):** still bounded, at 1,184 chars.
- **Default-config rows, unchanged:** s2 whole at 28,693, s7b whole at 29,320, s7 head+tail at 5,141.
- **Tests:** `shell.test.ts` + `coreToolScheduler.test.ts` stay at 756/756.

It would also be worth making the pin test assert that `Exit Code:` survives at a threshold around 600.

### 4. Tests

![tests and mutants](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11727/04-tests-mutants.png)

- **Head:** **756 passed**.
- **Counterfactual** (the PR's test files run against merge-base production code): **exactly the 11 new positive tests fail**.
- **Mutation probes on the production hunks: 11 of 13 killed.**
  - All three survivors from round 1 are now killed: the marker check in `errorBodyAlreadyBounded` (M7), the timeout call site (M9–M11) and the 120-char cap (M4).
  - M12 (the timeout else-branch ignores the marker) survives, but it is equivalent today: only Shell sets the marker, and Shell always declares `maxOutputChars`.
  - **M13 survives and confirms R3-2:** deleting the `attributionWarning` term from the reservation leaves both suites green.

### 5. Residuals and open review items

- **A failure hook still re-arms the gate** (round-1 follow-up 2, unchanged).
  - s2 plus a `PostToolUseFailure` hook gives a 2,498-char head-only stub on both arms. The hook text and `Exit Code: 3` exist only in the spill file.
  - This is a design call, not a regression.
- **R3-4 is a doc-accuracy issue, not a regression.**
  - On the timeout path, failure-hook context is appended with no combined pass after it.
  - With a 50k `additionalContext`, base already delivered 52,460 chars. Head delivers 78,657, now with the whole body in front of the hook text.
  - Both are bounded only by the aggregate batch budget. Invariant 5 in the design doc still claims the combined pass applies on this path.
- **Still open from round 3** (all Suggestions, no reply yet):
  - **R1-1:** the timeout re-bound duplicates the success-path bounding policy inline.
  - **R3-1:** `2026-08-10-tool-output-offload-preview.md:56` still lists "aborts" as unmarked. In fact the timed-out s5 body is marked, which is exactly why it now arrives whole.
  - **R3-2:** confirmed by M13 above.
  - **R3-3:** that design doc still has no `.zh-CN.md` sibling.
  - **R3-5:** not re-checked here.
- **Fixed since round 1:** follow-up 3 (the `tools.ts` doc comment).

### Merge checklist

- **CI on `c2d3c24df8`:** every required check is green; `review-pr` is still pending.
- **Reviews:** `reviewDecision` is `CHANGES_REQUESTED`, from qqqys and from the review bot, both at `8ac6e4d602`. Both requests are for the Critical that §2 shows is fixed, so they need a re-review or a dismissal.
- **Recommendation:** fold in the one-line half-cap from §3 before merging, or track it as a follow-up. Nothing else here blocks.

### Not covered

- Linux only; no macOS or Windows runs.
- I did not trigger the attribution-warning half of the reservation on the real CLI; that needs a `git commit` whose attribution note write fails. It is covered only by the M13 result.
- Spawn and setup failures could not be triggered through the real CLI. As in round 1, only the unit control test covers them.

Figures, harness scripts and raw per-run summaries: https://github.com/wenshao/qwen-code/tree/asserts/pr-11727
