## Maintainer verification, round 2 (delta) — #13330 @ `924484ef`

**Verdict: ready to merge on the code. The PR body needs an edit first.** Round 1 ([comment](https://github.com/QwenLM/qwen-code/pull/13330#issuecomment-6007415466), at `c096be36`) found one blocking regression and one should-fix divergence. Round 3 (`0f697026`) applied the round-1 candidate patch unchanged. It also fixed the two operability gaps (item 7, the warn-flood half of item 8) and added the tests for the mutation survivors. Round 4 (`924484ef`) merged `main` cleanly. I re-ran every round-1 probe at the new head against the new merge-base `43a6e1e5`. Everything round 1 flagged is now fixed. This report covers only the delta.

**Rig.** Same as round 1. The probes run the real `ManagedAgentServerApplication` (H2 file databases, the local-process provisioner, a real CLI worker built and bundled from this head), plus a real `qwen serve --profile hosted-harness` full-stack IT. The base arm is the merge-base `43a6e1e5`, so between the arms the production diff is exactly the PR's 9 files. The full-suite runs (mutation sweep, negative controls) ran on aarch64 (`maven:3.9.11-eclipse-temurin-21`), and the probes on x86_64 (`eclipse-temurin:21-jdk`).

### Round-1 findings at `924484ef`

| Round-1 finding | Now | Evidence |
|---|---|---|
| **F2 (blocking):** a CLOSED unbound Session could warm a real worker in-process | ✅ **Fixed.** CLOSED, ARCHIVED and DELETED refuse `warm` in the same process **and after a restart**. That is stricter than base, which warms all three after a restart | Fig. 1 |
| **F1 (should fix):** the tool-call item and the published result split into two items | ✅ **Fixed.** In all three event orderings the call and the result merge into one item, and `GET /items/{call}/tool-result` returns 200, the same as base. The path is still latent in the real hosted stack | Fig. 3 |
| **Item 8:** the warn flood returned at the 64 cap | ✅ **Fixed.** One poisoned Session: **13** WARN lines in 40 s (base: **393**). After the cap it logs one line about every 6.4 s, where base logs 10/s. Starvation stays fixed (**181 ms**; base: never within 15 s) | Fig. 2 |
| **Item 7:** the rename 503 left no log line | ✅ **Fixed.** Against a dead Hosted Harness, the server now logs `Hosted Harness rename failed` with the `ConnectException` cause. Base logs 0 lines | Fig. 3 |
| Mutation survivors m01, m06, m16, m17 | ✅ **All killed.** The round-1 set, re-anchored on the new code, is 17/17 killed. The 13 new mutants of the round-3 code are also all killed | Fig. 4 |
| Item 2 superseded by #13403; PR body stale | ⚠️ **Still open, and the body is now wrong in more places** (see below) | — |

![close fence](r2-fig1-close-fence.png)

**F2.** Fig. 1 shows the full matrix. Lifecycle changes go through the public HTTP API, and then `EmbeddedRuntimeBroker.warm()` makes the call `HarnessCoordinator` makes for a dispatched Turn. Because `drain()` now retires only a vanished row, the in-process set no longer grows on any lifecycle path (`in_process_retired=false` for all three).

**A check of the round-1 fix itself.** Round 1 proposed putting `CLOSING` (and every other lifecycle status) in the resolver fence. The resolver serves more than `warm`: `acquire`, `release` and `reconcile` also resolve the scope when the Runtime Session is not held in this process. So I added `release` cells, using the path the Harness provider uses (lower table in Fig. 1):

- **Same process:** the Session releases on both arms, whatever the row status, because that route never consults the resolver.
- **After a restart:** neither arm can release the Session, and the runtime row stays `READY` on both. The only difference is the answer. For a `CLOSING` or `CLOSED` row, base returns `503 runtime_reconciliation_required` (retryable) and head returns `409 runtime_broker_session_closed` (terminal).
- **Reachability:** this path is not reachable today. In the real hosted stack, unbound Turns are sent 0 tools (Fig. 3), so they never acquire a Runtime Session.

Not a finding. I'm noting it so nobody treats it as a regression later.

![materializer](r2-fig2-materializer.png)

![identity, rename, reachability](r2-fig3-identity-rename.png)

### Tests, mutation and negative controls

![mutation](r2-fig4-mutation.png)

- **Full suite:** the unmutated head runs 1043 tests with 0 failures (2 skipped), and the merge-base runs 1020 with 0 failures. Both runs were on aarch64; CI covers x86.
- **Negative control A (round 3 only).** I compiled round 3's test classes against the previous head `c096be36`. Of 748 tests, exactly **8 go red**, all of them round-3 witnesses: the fence test for `CLOSING`, `CLOSED`, `ARCHIVING` and `DELETING` (`ARCHIVED` and `DELETED` were already fenced at `c096be36`), plus `drainDuringSettleStillFencesTheWarm`, `toolCallIdentityMatchesTheStoredProjectionRule`, `atTheCapRetriesOnceEveryMaxStreakPasses` and `aFailedRenameLogsAndChainsTheRootCause`. `ManagedMaterializationDeferTest`, `drainRetiresASessionWhoseRowIsGone` and `drainLeavesAnActiveSessionWarmable` stay green there, as they should. They pin behaviour `c096be36` already had, and they earn their keep in the mutation sweep (m16/m17, m07 and m06).
- **Negative control B (whole PR).** I compiled the PR's changed test classes against the merge-base `43a6e1e5`, leaving out the two classes that need the new interface method. Of 1039 tests, **14 go red** (6 of them the parameterized fence cases), all of them PR witnesses.
- **Mutation: 30/30 killed**, each by a PR test, running the full suite per mutant.
  - All four round-1 survivors are now killed: **m01** (rename cause dropped), **m06** (`drain()` retires unconditionally), **m16** (the defer SQL is a no-op) and **m17** (the defer SQL also bumps `covered_sequence`).
  - **n01–n06** each drop one status from the fence set, and each is caught.
  - **n08–n10** cover the cap gate: retry every pass, never retry, and re-clamp the counter (the round-2 shape). All three are caught by `atTheCapRetriesOnceEveryMaxStreakPasses`.
- **Two pre-existing tests are excluded from kill decisions.** `RuntimeBrokerDefaultOnTest`, the round-1 aarch64 timing race, failed in 16/30 mutant runs. `HarnessCoordinatorTest.runningOwnerObservesCancellationAfterStreamingStarts` failed in 2/30, with `TooManyActualInvocations` on `cancel`, under mutants that don't touch that path. The PR touches neither test, and both passed in the unmutated head and base runs. Every mutant is still killed without them.

### Merge with `main` (round 4)

- **The logical diff is unchanged.** I compared the PR against the old merge-base (`3172c9fd`→`0f697026`) and against the new one (`43a6e1e5`→`924484ef`). Both cover the same 17 files with +577/−18. The changed lines are identical (595 lines); the only difference is where one blank line sits around the new `store` field, next to `main`'s `workspaces` field.
- **The new `main` code does not reach the fence.** The fence runs after the workspace branch of the resolver, so bound Sessions never evaluate it, and W2's `verifyWorkspaceCwdTarget` and the bound close path (`closeWorkspace`) are untouched by it. The Kubernetes wording is still accurate after #13289. That PR adds the experimental CSI runtime pieces (the CLI worker and a durable worker-ACK store), but the embedded broker still refuses `provisioner=kubernetes` at startup with the PR's message (re-run at this head).
- **CI at `924484ef` is green on every lane.** That includes the full SDK Java matrix, `Runtime Broker and Managed Agent MariaDB`, `Hosted process fault gates / MySQL 8.4` (red at `0f697026`, green here) and `Real daemon E2E`. Only `review-pr` and `fallback-comment` failed, and both belong to the review pipeline, not this code.

### Cross-check of the triage sandbox run ([comment](https://github.com/QwenLM/qwen-code/pull/13330#issuecomment-6016016971), same head)

It reports `findings` (non-blocking) with 34/34 assertions passing, and its 13 per-hunk reverts agree with my sweep. I checked its three findings on the real application:

- **Finding 1, "`MessageMaterializer.failures` grows without bound":** the premise does not hold for close or delete. I poisoned 4 Sessions, then closed one, deleted one, and caught one up outside this materializer, which is what another server instance would do. Over the next 15 s, the closed and the deleted Session were **still selected**, still retried at the cap (3 WARN lines each), and their entries stayed in use (streak 170). The reason is that `findMaterializationTargets` has no status filter, and nothing in the server physically deletes Session or progress rows. Only the Session caught up elsewhere left an orphaned entry (stuck at streak 20, no longer selected). So the map grows only with Sessions that failed on this instance and were caught up by another one. From the code, an orphaned entry's only effect is that this instance skips up to 63 passes (about 6.3 s) if that Session becomes a target here again. Fine to leave deferred, as the author did. Retrying a deleted poisoned Session forever is pre-existing: base selects it too, and logs 146 WARN lines for it in the same 15 s where head logs 3.
- **Finding 2, "the Session Store base URL is still unvalidated":** reproduced on the real startup path. With `session-store.enabled=true`, both `localhost:4170` and `https://` start on base and on head. This is pre-existing and outside this PR, so it's a good follow-up next to item 4.
- **Finding 3, the "`:sequence:` fallback has the same collision shape":** I agree it is static only. That fallback is part of `EventIdentity` v1, which names already-stored items, so changing it belongs in its own projection-version change, not here.
- **Its two body corrections** are items 1 and 3 in the list above.

### Before merging: the PR body

The body still describes code that is no longer in the PR. Reviewers read it, and so does the merge record:

1. **"Attach concurrency … the fetch now happens before `putIfAbsent`"**: not in this diff. It was superseded by #13403.
2. **"`drainStillRetiresAClosedSessionInProcess` pins that close keeps its in-process retirement … drain adds only CLOSED rows"**: now the resolver fences all six lifecycle statuses durably, and `drain()` retires only a vanished row.
3. **Risk: "Tool item ids for callId-bearing tools change (`:call:` tag)"**: no longer true. The callId ids are unchanged (EventIdentity v1). Only the no-id fallback moves, to `#source:`.
4. **"Cause chaining … log-only change"** and **"a hard-poisoned single session still warns … bounded by the 64-streak cap"**: now there is a WARN with the cause, and at the cap the materializer retries once every 64 passes.
5. **"562 tests"**: the module now has 1043 unit tests.

### Not re-verified this round

- I did not run the MariaDB or MySQL lanes locally; CI is green on them at this head.
- My full-suite runs were on aarch64 only. x86 coverage comes from CI (ubuntu Java 11/17/21).
- The author deferred the `RuntimeBrokerDefaultOnTest` aarch64 timing race from round 1 as outside this PR (this round it was red in 16 of 30 mutant runs and in negative control B on base code, and green in the unmutated head and base runs).

Evidence (probes, logs, sweep results, screenshots): this directory
