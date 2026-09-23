## Maintainer verification — PR #12546 @ `fad23c5` (local real-model rig)

**Verdict: mergeable after one small prompt fix. The fix is below and I've verified it.** I measured no behaviour regression in 188 real-model runs. The token table reproduces exactly and the safety sections are byte-identical. Two things from the `/review` round (review 5292700110) should still be fixed before merge. One is R1-1, the "did not run" → "could not run" narrowing of a safety-anchor clause. The other is R1-3, a lost blank line that folds two global rules into the workflow list. Both are prompt-text-only, and the patch below fixes both. The remaining R1 items are doc and comment accuracy.

The PR also still needs the template items from the triage stop: `## Linked Issues` and the `中文说明` block.

Setup: three arms, each installed with pnpm and fully built. **base** = merge-base `40ef07a`, **head** = `fad23c5`, **neg** = head with only `packages/core/src/core/prompts.ts` reverted. The model is qwen3.8-max (thinking), called through a logging reverse proxy. `--yolo` headless sessions declare 14 tools, including `run_shell_command`, `grep_search`, `glob` and `agent`. I confirmed on the wire that base sends the old text and head sends the new.

### 1. What the PR claims — all reproduced

![tests and tokens](f3-tests-tokens.png)

- **Token table: exact match on all 5 rows** (o200k_base: −287 / −287 / −287 / −287 / −278). As a cross-check, the provider-billed count for the main request goes from 16,767 to 16,475 input tokens (−292).
- **Scope:** I rendered 192 prompts: 4 model families × 3 modes × todo on/off × CodeModeOnly on/off × 4 declared-tool surfaces.
  - Only 6 sections change: Software Engineering Tasks, Communicating, Tone, Using Your Tools, Git Repository, Git as Source of Truth.
  - Heading sets are identical, and every other section is byte-identical, including Executing actions with care, sandbox and permission rules.
  - The rendered base and neg prompts are byte-identical in 192/192. The only production change is `prompts.ts`.
- **Declared-tool gating:** every `TOOL_GUIDANCE_LINE_GATES` prefix is still present. On the gated surfaces (headless-default, no-shell, shell-only), the diffs touch only the intended lines.
- **Tests:**
  - core `prompts + client + prompt-tool-examples + ArenaManager`: 659/659 on base and 659/659 on head.
  - **neg: 17 failed, all `Snapshot … mismatched`**. So no semantic assertion pins the edited text. See §4.
  - cli `contextCommand.test.ts` (the prompt-size coupling that broke #12360): 43/43 on all three arms.
  - Prettier and ESLint are clean on the changed files, and CI is green.

![rendered prompt diff](f1-prompt-diff.png)

### 2. Real-model A/B on the rules this pass deletes outright

Five rules are gone from all 192 head renders, not merely de-duplicated:
- "Lead with the outcome for simple tasks."
- the shell tie-breaker "if you are unsure … default to the dedicated tool"
- subagents "should not be used excessively"
- "current state → reading the code"
- the Key Principle "progress quickly" line

The PR body calls these redundant. I tested the behaviours they target directly, using a fresh session per run and the same fixture for both arms. There were 128 read-only runs, 64 per arm, and all 128 succeeded:

![A/B](f2-ab.png)

- **Shell vs dedicated tools** (what the dropped tie-breaker targets): no drift.
  - At n=6, `check` briefly showed head using shell-`ls`/`cat` twice as often. I extended that task to n=20, and the gap vanished: 23 vs 21 read/list shell calls, in 18/20 vs 19/20 runs.
  - The cat-tempting task "summarize each src/lib file" produced 0 shell calls on both arms.
- **Subagent overuse:** I ran directed searches in a 1,628-file copy of `packages/core/src`. Both arms made 0 `agent` calls in 32 runs and went straight to `grep_search`. Answers were correct in 16/16 per arm.
- **Answer shape (R1-6's concern):** "is X exported?" starts with "Yes" in 6/6 runs on both arms. No answer on either arm grew a Risks or Next-steps section (0/64 vs 0/64). Head answers are ×1.03 longer, with permutation p≈0.42.
- **Correctness:** 28/28 per arm on the tasks with a checkable answer.

This covers one model family in headless `--yolo` mode. It is evidence against a regression, not proof of none.

### 3. `/review` R1 — each finding re-run

![R1](f4-review-r1.png)

| id | status at `fad23c5` | my read |
| --- | --- | --- |
| **R1-1** "did not run" → "could not run" | Reproduced. The clause appears in 192/192 base renders and 0/192 head renders. | I ran 60 real edit tasks ("make `reserve` throw RangeError"; plain and "keep it snappy" prompts; 10 runs × 3 arms each). Every run ran `npm test`, and head never skipped check/lint silently (0/14 vs base 1/12). So nothing regresses on this model. The text is still a real narrowing of a clause that `docs/plans/…token-governance.md` lists as a safety anchor. The fix costs ~8 tokens, so **fix before merge**. |
| **R1-2** "No bullet label … removed" | Reproduced. `Verify (Tests)`, `Verify (Standards)` and `Key Principle` are gone. The same false sentence appears in both language versions. | Doc-only. Drop the sentence or qualify it. |
| **R1-3** lost trailing blank line | Reproduced. In 192/192 head renders, the `<system-reminder>` / `<persisted-output>` bullets become items 6–7 of the "follow this iterative approach" list. | **Fix before merge.** It's the same patch. |
| **R1-4** CodeModeOnly copy unpinned | Reproduced. Reverting the CM `Reserve` line to base wording leaves 190/190 green. The same revert on the direct copy fails 17 tests. | Pre-existing gap, non-blocking. Worth a test while both copies are being edited. |
| **R1-5** stale 1,421 / 1,104 figures | Reproduced. The saving under the test's own `promptFor(FILE_WORK_TOOLS)` is now **1,135**. | Update the test name and comment and the verification README. |
| **R1-6** "Lead with the outcome" / "when relevant" dropped | Text reproduced. No behavioural effect measured (§2). | Record both as deliberate removals in the design doc rather than calling them redundant, or restore them. Either is fine by me. |

### 4. Verified patch for R1-1 + R1-3

This uses R1-1's suggestion verbatim, adds the trailing blank line for R1-3, and adds one pinning test. The test also covers two merged-Verify anchors from the Reviewer Test Plan, which today only snapshots protect:

```diff
-- **Report outcomes faithfully:** If a check fails, say so with the relevant output; if you could not run a verification step (no test exists, can't run the code), say that rather than implying it succeeded. Never claim …
+- **Report outcomes faithfully:** If a check fails, say so with the relevant output; if you did not run a verification step — including when you could not (no test exists, can't run the code) — say that rather than implying it succeeded. Never claim …
+
 `;
```

```ts
  it('keeps the merged verification and faithful-reporting rules', () => {
    vi.stubEnv('SANDBOX', undefined);
    const prompt = getCoreSystemPrompt();
    expect(prompt).toContain('NEVER assume standard commands.');
    expect(prompt).toContain(
      'Read-only or explanatory turns do not require verification.',
    );
    expect(prompt).toContain('did not run a verification step');
    expect(prompt).toContain(
      'or broken work as done.\n\n- Tool results and user messages',
    );
  });
```

Results with `-u`:
- The snapshot diff is exactly 17 × the Report-outcomes line plus 17 × one blank line.
- core suites pass 660/660, and cli `contextCommand` passes 43/43.
- Prettier is clean.
- Reverse mutants on the new test: reverting to "could not run" goes red, and dropping the blank line goes red. Deleting either Verify anchor sentence alone also goes red (checked on head).

Evidence is in [`wenshao/qwen-code@asserts/pr-12546`](.):
- all four figures
- `harness/`: renderer, section differ, logging proxy, A/B runner, and the task prompts
- `data/runs.json`: all 188 real-model runs, with tool calls and final answers
- `data/fix.patch`
- the three-arm test logs
