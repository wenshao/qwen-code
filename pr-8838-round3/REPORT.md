## Maintainer verification, round 3 (delta): head `acab7be2a0` on today's `main`

**Verdict: ready to merge from my side.** The round-2 blocker is fixed with exactly the patch I posted, CI is now fresh and green on this head, and everything I measured on the real daemon in round 2 still holds on today's `main`. Two new results this round:

1. **Optional, test-only.** The round-12 review deferred one item: the negative assertion at `Session.test.ts:27739`. It really pins nothing. It went stale for the same reason as the assertion I fixed in round 2, and I missed it then. A 6-line patch is in section 2. I'd fold it in if the branch gets another push, but I wouldn't hold the merge for it.
2. **R11-1 is not new with this PR.** `main` already shows the same live/cold split with no scheduled task involved: two ordinary prompts fail, the user retries, and the daemon restarts (section 3). The cron record behaves exactly like a user-prompt record. I still consider it non-blocking. The fix belongs in the retry path, for both record types.

---

### 1. The new head, re-run on today's `main`

`acab7be2a0` differs from the tree I verified in round 2 (`a8ad4d3b67` merged onto `57e720bc97`) only by the round-2 patch, byte for byte. I merged it onto `main` `310f4ba3ab`, which is 4 commits later; none of them touch session, recording, cron or Web Shell production code. The merge is clean, and the PR diff is still the same 2 files.

| Check | Result |
| --- | --- |
| `Session.test.ts` on the merged tree | **1110 passed (1110)** |
| `tsc --noEmit -p packages/cli`, `eslint --max-warnings 0`, `prettier --check` | clean |
| `Qwen Code CI` on `acab7be2a0` ([run](https://github.com/QwenLM/qwen-code/actions/runs/36791518776), 2026-09-30 23:31 UTC) | success: `Lint & Static`, `Test (ubuntu-latest)` and `Integration Tests (no-AK)` passed. The CLI integration and macOS/Windows test jobs were skipped in that run. |

I also re-ran all six round-2 cells against a real `qwen serve` daemon and the real Web Shell, from fresh bundles of the new tree. The two arms differ only in `Session.ts`.

| Scenario | `main` | PR |
| --- | --- | --- |
| Fire succeeds, then restart: does the cold model history equal the live one? | ❌ two assistant messages welded together | ✅ equal |
| Fire fails, then restart: `recovery` from `GET /session/:id/context`, live → cold | `interrupted_prompt` → `clean` | `interrupted_prompt` → `interrupted_prompt` |
| … then click **Continue execution** in the Web Shell | no banner | task answered; task text appears once in the request; 1 cron record |
| Prompt fails, fire fails, retry, then restart | cold equals live | cold re-merges the task (R11-1, section 3) |

**One correction to my round-2 data (the conclusions stand).** In round 2, the PR's cold `interrupted_prompt` came from the rendered banner. The `data/head-fail/context-cold.json` file in that folder was captured *after* the Continue click, so it shows `clean`. This round the harness reads `GET /context` on the cold daemon before any UI touches the session (`context-cold-before-continue.json`):
- `main`: `clean`, `canContinue: false`
- PR: `interrupted_prompt`, `canContinue: true`

### 2. Optional (test-only): the negative `recordUserMessage` assertion can never fail

The test `persists a non-sentinel cron prompt and keeps the session interactive` contains:

```ts
expect(
  mockChatRecordingService.recordUserMessage,
).not.toHaveBeenCalledWith('do the normal cron thing');
```

`toHaveBeenCalledWith` matches the full argument list. Since #11062, both production `recordUserMessage` call sites pass 5 arguments. A 1-argument expectation can therefore never match, and the `.not` always passes. This is the silent twin of the assertion I fixed in round 2.

To measure it, I used a mutant that also records the cron prompt as a user turn. Right after `recordCronPrompt`, it calls `recordUserMessage(modelText, undefined, undefined, 'cron-mutant', undefined)`. Results on the merged tree:

| `Session.test.ts` | Result |
| --- | --- |
| mutant, test as on the branch | **1110 passed**: the mutant survives the whole file |
| mutant, patched test | 1 failed (this test) |
| no mutant, patched test | 1110 passed |
| `Session.ts` from `main`, patched test | 7 failed, the same 7 as in round 2 |

The patch below uses the file's existing `.mock.calls.map(...)` pattern. With it applied, `tsc`, `eslint` and `prettier` are clean.

```diff
         expect(
-          mockChatRecordingService.recordUserMessage,
-        ).not.toHaveBeenCalledWith('do the normal cron thing');
+          mockChatRecordingService.recordUserMessage.mock.calls.map(
+            (args) => args[0],
+          ),
+        ).not.toContain('do the normal cron thing');
```

### 3. R11-1: `main` has the same live/cold split without any scheduled task

The round-12 review re-raised R11-1 as Critical. To test that, I added a control scenario with no cron at all:
1. Two ordinary prompts fail during a provider outage.
2. The provider recovers, and the user retries the second prompt with `retry: true`, which is what **Try again** sends.
3. The daemon restarts.

<img width="880" alt="Retry strip vs transcript: main without cron, and the PR's R11-1 path" src="./01-retry-strip-preexists-on-main.png">

```
# main, no cron: model history before the next prompt (from the provider's request log)
live   user 'OUTAGE-PROMPT: check the build status.'
cold   user 'OUTAGE-PROMPT: check the release notes.OUTAGE-PROMPT: check the build status.'
# PR, R11-1 path (prompt fails, fire fails, retry)
live   user 'OUTAGE-PROMPT: check the build status.'
cold   user 'OUTAGE-PROMPT: check the build status.FAILING-TASK: rebuild the search index.'
```

The PR arm gives the same result as `main` in the cron-free scenario.

This is how retry already works on `main`. `Session.ts` strips the trailing user entries from live history and skips `recordUserMessage` "to avoid duplicating the user turn in the JSONL transcript". It never retracts the transcript records of the other entries it stripped. The PR's cron record follows the same rules as a user-prompt record. That explains why the review's own analysis concludes the only real fix is cross-layer.

My suggestion for the follow-up: when a retry strips entries, write a record of that, for user prompts and cron records together, and track it next to #8885. The round-12 `CHANGES_REQUESTED` review rests only on R11-1. I don't think that is a reason to hold this PR.

### 4. Not covered

- The other R11-1 entrance (a fire cancelled during send preparation) was not re-run end to end. Its precondition is covered by the unit test the review cites.
- As in round 2: Linux only, and `per_run`, `<<loop.md>>` / `@wakeup` and channel-delivery fires were not re-run.

The harness, raw transcripts, provider request logs, `/context` snapshots, mutation results and vitest summaries are in [`pr-8838-round3/`](.). `harness/run.sh <base|head> <ok|fail|retry|uretry>` reproduces each scenario, and `harness/mutate.sh` reproduces section 2.
