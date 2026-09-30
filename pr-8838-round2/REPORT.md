> Posted to https://github.com/QwenLM/qwen-code/pull/8838 · verified tree: PR head `a8ad4d3b67` merged onto `main` `57e720bc97` (2026-09-30)

## Maintainer verification, round 2 (delta): real `qwen serve` daemon and Web Shell, merged onto today's `main`

**Verdict: the production change is correct and still needed on today's `main`. I'd merge it after one test-only fix.** Merged onto current `main`, the branch ships **one red test**: `Session.test.ts` gives `1 failed | 1109 passed`. The green CI on this head is stale. The last `Qwen Code CI` run was on 2026-08-31, before `main` changed the call that the assertion pins. A four-line fix to that one assertion makes the file `1110 / 1110`. The patch is at the bottom of section 2 and was measured on the merged tree. After that, a CI re-run is all that's left.

This round only covers what earlier rounds did not:
- My round 1 ([comment](https://github.com/QwenLM/qwen-code/pull/8838#issuecomment-5468241624)) used a real ACP stdio child and a TUI `--resume`, at `5b539d0d1` on an Aug-30 `main`.
- The sandboxed run ([comment](https://github.com/QwenLM/qwen-code/pull/8838#issuecomment-5884082960)) worked in-process, left two open questions, and reported the red test.

Here the PR head `a8ad4d3b67` is merged onto `main` `57e720bc97` (2026-09-30, 1187 commits after the PR's last merge base; the merge is clean and the diff is still exactly the 2 files, `+303/−5`). Everything is driven through a real `qwen serve` daemon, with the real Web Shell in Chromium. That is the "deployed daemon and browser replay" item the PR description lists as not validated.

**Rig.** Both arms are bundled from the same merged tree. The only difference is `packages/cli/src/acp-integration/session/Session.ts` (the `main` version vs. the PR version); the bundles differ in `recordCronPrompt(` call sites, 2 vs 3. A content-keyed fake OpenAI server makes the model call the real `cron_create` tool (`* * * * *`, recurring, session-only). The real scheduler fires it inside the session. Then the daemon is stopped and restarted cold, and the session is opened in the Web Shell. Each scenario used a fresh `QWEN_HOME`.

---

### 1. The bug still reproduces on today's `main`, and the PR fixes it in the Web Shell too

<img width="880" alt="Web Shell cold replay, main vs PR" src="./01-webshell-cold-replay-ab.png">

| After a cold restart (same scenario, both arms) | `main` | PR |
| --- | --- | --- |
| `chats/<id>.jsonl` record for the fired prompt | ❌ none | ✅ `type=user subtype=cron provenance=system`, `displayText` = the task |
| Web Shell replay | ❌ the scheduled result is shown as the answer to the user's previous prompt. That turn now "took 21 s", and its real reply is folded behind the collapsed row (confirmed by expanding it). | ✅ the task is its own turn, followed by its result |
| History the model receives on the next prompt | ❌ two assistant messages welded together (below) | ✅ `user(task) → assistant(result)` |

```
# main: restored history on the first prompt after restart (from the provider's request log)
user       'SCHEDULE-IT: post the nightly report every minute'
assistant  'Scheduled. It will run every minute.NIGHTLY-REPORT-RESULT: repository health is green.'
user       'FOLLOWUP-LIVE: what did the scheduled run report?'
# PR
assistant  'Scheduled. It will run every minute.'
user       'NIGHTLY-REPORT-TASK: summarize repository health and post the nightly report.'
assistant  'NIGHTLY-REPORT-RESULT: repository health is green.'
```

Before the restart, the live session's requests were identical on both arms, task included; `main` loses the task only on restore. The PR's cold history is identical to that live history. So this also repairs the restored model context, not only the transcript display.

### 2. Blocking (test-only): one PR assertion is stale on today's `main`

`persists a non-sentinel cron prompt and keeps the session interactive` asserts `recordUserMessage` was called with **exactly** `('follow-up')`. #11062 (2026-09-09) changed that call site on `main` from one argument to several, and it now passes 5. Both sides were green on their own, and the textual merge is clean, so only the merged tree is red:

| `Session.test.ts` on PR ⊕ `main 57e720bc97` | Result |
| --- | --- |
| as merged | **1 failed \| 1109 passed (1110)**: `expected "spy" to be called with arguments: [ 'follow-up' ]`, received `"follow-up", undefined, undefined, "test-session-id########2", undefined` |
| with the patch below | **1110 passed (1110)** |
| negative control: patch kept, `Session.ts` reverted to `main` | **7 failed \| 1103 passed**, the same 7 cron-recording tests as round 1 (e.g. `expected "spy" to be called 1 times, but got 0 times`). The tests still gate the production change. |

The patch follows the file's existing 5-argument pattern (e.g. the `recordUserMessage` assertions in the `inputAnnotations` tests):

```diff
         expect(mockChatRecordingService.recordUserMessage).toHaveBeenCalledWith(
           'follow-up',
+          undefined,
+          undefined,
+          expect.stringContaining('test-session-id########'),
+          undefined,
         );
```

With it applied, `tsc --noEmit -p packages/cli` exits 0, and `eslint --max-warnings 0` and `prettier --check` are clean on both changed files.

### 3. The sandboxed run's open questions, answered on the real daemon

**(a) "Do cron turns record assistant output at all?" Yes.** In the real daemon JSONL, the cron record is followed by an `assistant_output` record with the result (`data/head-ok/transcript.jsonl`). So the issue's "result without the task" symptom is real (section 1), and a transcript can only end in a cron record when the fire itself fails or is cancelled.

**(b) The "interrupted" recovery banner on a cron-tailed session was already there before this PR. The PR makes cold restore match live.** Scenario: the fire fails with a provider 400, then the daemon restarts. Values are `recovery` from `GET /session/:id/context`:

| | live, before restart | cold, after restart |
| --- | --- | --- |
| `main` | `interrupted_prompt`, `canContinue: true` | `clean`, `canContinue: false` |
| PR | `interrupted_prompt`, `canContinue: true` | `interrupted_prompt`, `canContinue: true` |

On `main`, a fresh tab on the live session already shows "The previous request was interrupted…" with **Continue execution**, but the request it refers to is not visible. After a restart, both the fire and the banner disappear:

<img width="880" alt="main: failed fire, live vs cold" src="./02-failed-fire-before.png">

With the PR, the banner has its context. Clicking **Continue execution** in the real UI (`POST /session/:id/continue`) answers the task. The continuation request carries the task text exactly once, and the transcript still holds **exactly one** cron record, with the answer after it:

<img width="880" alt="PR: failed fire, cold, then Continue execution" src="./03-failed-fire-after.png">

### 4. Non-blocking: R11-1 is reachable without the compression race

The autofix round confirmed R11-1 by cancelling during send preparation. A more ordinary path reaches the same divergence:
1. The provider is down, and the user's prompt fails.
2. The scheduled fire also fails.
3. The provider recovers, and the user retries with the same body the Web Shell's **Try again** sends (`retry: true`).

The retry strips the trailing user entries from live history, but the cron record stays in the transcript:

```
# live history the model saw for the next prompt (both arms)
user       'OUTAGE-PROMPT: check the build status.'
assistant  'OUTAGE-PROMPT-RESULT: build is green.'
# PR: the same position after a cold restart; the stripped task comes back, merged into the retried prompt
user       'OUTAGE-PROMPT: check the build status.FAILING-TASK: rebuild the search index.'
assistant  'OUTAGE-PROMPT-RESULT: build is green.'
```

`main` keeps cold equal to live here only because it persists no cron record at all. The effect is limited to one extra line of task text in the restored context, and it needs a failed prompt, a failed fire and a retry in that order. The replay is arguably accurate as a display (the fire did happen). I agree with the existing disposition: don't block on it, and track it with the other automatic-record/retry alignment work (the deferred-findings entry, next to #8885). I did not verify the autofix round's claim that `notification` records already behave this way on `main`.

### 5. Not covered

- macOS / Windows (Linux only; nothing in the hunk is platform-specific).
- The rewind-index follow-up (#8885, still open) was not re-verified.
- `<<loop.md>>` / `@wakeup` ticks and channel-delivery fires were not re-run this round. Round 1 and the unit tests cover the first two; `per_run` tasks go through `#dispatchCronToFreshSession`, not the patched block.

Harness, raw transcripts, provider request logs, `/context` snapshots and the vitest summaries are in [`pr-8838-round2/`](.) (`harness/run.sh <base|head> <ok|fail|retry>` reproduces each cell).
