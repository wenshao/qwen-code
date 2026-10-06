## Real-environment verification, round 3: `3261e4d4`

**Verified head:** `3261e4d4`, which is the round-2 head plus two commits:
- `0aa09f1c`, a merge of main `ac81c07d`. I recomputed it with `git merge-tree`: its tree is byte-identical to git's own automatic merge, so there are no hand-resolved hunks.
- The F3 commit.

**Trial merge:** `3261e4d4` merged into current main `ac497aee` (2 more commits). Same rig as before: Spring Session Store on native MySQL 8.4.7, the real TS authority over HTTP, and a raw-HTTP second writer.

> **Revised** after I first posted this comment. While round 3 was running, two change requests landed: the `/review` bot's on `0a1b1d2e` (17:43) and yiliang114's on `3261e4d4` (17:52). I had not read the first before publishing. Their blocking findings all reproduce on `3261e4d4`; the verdict below replaces "ready to merge".

### Verdict

**Not ready yet.** Both reviews block on the same two contract gaps, and both reproduce on the current head, identically in TypeScript and Java:
1. A dispatched or attached `child_agent` with no Runtime binding.
2. A `workingDirectory` that is absolute or aliased on Windows.

The candidate below closes both, plus R1-1, in both languages and with shared fixtures. R1-3 (definition pin at dispatch) needs a design choice from the author.

Everything from rounds 1–2 still holds on the head and on the trial merge: F1–F4 are closed and match what I verified. The two red CI legs on `3261e4d4` reproduce on main without this PR.

### The review findings, re-checked on `3261e4d4`

I probed every finding through the current head's real validators (h3 TS dist + h3 jar). R1-1 also went through the Hosted Harness `/session/:id/load` route.

| Finding | On `3261e4d4` (TS / Java) | With the candidate |
| --- | --- | --- |
| **Runtime binding.** [R1-2](https://github.com/QwenLM/qwen-code/pull/13505#discussion_r4198482616) and yiliang114 P1 | `dispatch_started`, and `running_attached` with `childSessionId`, are both **accepted with `runtime: null`**. A later revision that adds the binding is refused, so the run can never be bound. | both refused in both languages. `not_started_proven` may still lack a binding, as the valid fixtures `agent-creation-failed` and `agent-cancel-before-dispatch` require. |
| **Path safety.** [R1-4](https://github.com/QwenLM/qwen-code/pull/13505#discussion_r4198482627) and yiliang114 P1 | **Accepted** in both languages: `C:/evil`, `c:/evil`, `C:evil`, `D:/outside`, `C:/Windows/System32`, `CON`, `NUL.txt`, `a/CON`, `COM1`, `lpt1`, `childA.`, `childA ` | all refused (drive spec, device names in any segment with or without an extension, trailing dot or space). `.`, `worktrees/child-1`, `/tmp`, `a\b` are unchanged. |
| **Restore walk.** [R1-1](https://github.com/QwenLM/qwen-code/pull/13505#discussion_r4198482609): `verifyWorkspaceRestore` walks every `child_run` revision with `parseChildShellRun` | A Session whose journal also holds one `child_agent` run fails to load with **409 `hosted_turn_recovery_required`**; the same Session without it loads with 200 | parse by kind and skip `child_agent` (it owns no output manifest): **200**. The 4 existing restore cases still pass. |
| **Definition pin.** [R1-3](https://github.com/QwenLM/qwen-code/pull/13505#discussion_r4198482592) and yiliang114 P2 | `dispatch_started` without `definition` is **accepted**, and adding the pin later is refused | not in the candidate: requiring it fails 13 tests, because the authority suite's `runBlock()` dispatches with `definition: null`. The builders have to change first, or the doc has to call the pin optional. |
| **`resultVersion: 1e400`.** yiliang114 P2 (Java `decimalValue()`) | Over HTTP the store's reader refuses non-finite numbers before any validator runs: **409** "The Stage H record is not a JSON object the Session authority can read." The Session opens, and there is no `NumberFormatException` in the server log. TS refuses at its reader too. | unchanged; the 500 is reachable only by calling the validator directly |

**R1-1:** the two reviews disagree. The bot rates it Critical. yiliang114 calls it unreachable while the domain is disabled and something H4b must handle. It is the mirror image of F3, which this PR already fixed, and the fix is about 10 lines, so the candidate folds it in.

**Correction to my round 2:** I listed the cli callers as already correct. This walk enumerates the whole domain, so the shell-only parser fails closed there.

**Placement matters for the Runtime guard.** Placed where the bot suggests, it keeps every verdict but changes the reported clause of 8 invalid fixtures, which would make them fail. Placed last (the TS clause order, as for F1), all fixtures pass.

**Candidate on top of `3261e4d4`:** R1-1, the Runtime binding at dispatch, and `workingDirectory` safety, in TS + Java, with 8 shared fixtures and 1 restore test (5 files, +234/−14).
- Java contracts + store: 36/36, checkstyle clean.
- TS focused (6 files): 386/386.
- TS `managed-runtime`: 2303/2304. The one failure is the `hook-scale` timeout, which passes 6/6 on rerun.
- cli (3 files): 232/233. The one failure is a takeover case, and the file passes 210/210 on rerun.
- `tsc` (core + cli), eslint and prettier: clean.
- Differential: 0 disagreements over 573,903 rows.
- Witnesses:
  - Without the TS fix, all 8 new fixtures fail.
  - Without the Java fix, the Java contract test fails.
  - Without the R1-1 fix, the restore test fails (`expected 409 to be 200`).

![review findings](IMG3)

<details><summary>Candidate patch (TS + Java + 8 fixtures + restore test)</summary>

```diff
PATCH_R3
```
</details>

### What changed and what I checked

- **F3 fix and tests match round 2.**
  - The `local-shell-stream-result-session.ts` change (`parseChildShellRun`) is byte-identical to the round-2 candidate.
  - The new test differs by one comment word ("call id" vs "key").
  - The J7b store chain and the T7b authority case are byte-identical to round 2.
  - On `3261e4d4`, a Background Shell capture against a `child_agent` record is **refused**, and the PR's own case passes (the file has 6/6).
- **Mutants on the head:** all killed except the pre-existing J9. That covers J1–J8, J7b, JF1–JF3, T1–T8, T7b, and **TF3**, which aliases the import back to `parseChildRun`.
- **Differential (573,903 rows):** 0 disagreements on the head and on the trial merge. Main's refactor of the shared `closed()`/`id()` helpers to lazy messages changed no message; the wording-only diff list is identical to round 2.
- **Real stack (head and trial merge):**
  - All 23 probe rows are identical to round 2: 7/7 malformed identities get 409, 10 cross-record violations get 409, and the 2 controls get 200.
  - Settling revisions that cite an unheld result or receipt get 409 `managed_session_resource_missing`; the control gets 200.
  - The raw-HTTP control lines still pass #13355's stricter event-line checks, so the rig itself was not refused.
- **Suites:**
  - TS focused, 6 files: 378/378 on both arms.
  - The PR's `ManagedExtensionRecordStoreTest` on MySQL 8.4.7: 22/22. The count is 22 because #13355 reshaped main's version of the class, as the author noted.
  - Trial merge, Java ITs on native MySQL: 53/53.
  - Trial merge, TS `cli-serve`: 233/233.
  - Trial merge, TS `managed-runtime`: one `hook-scale` 15 s timeout, the same family as rounds 1–2.

![round 3 verification](IMG1)

### The two red CI legs come from main

| CI leg | Failure | On this head (local) | On pure main `ac81c07d` |
| --- | --- | --- | --- |
| `Test (ubuntu-latest, Node 22.x)` | `cli … acp-integration/session/Session.test.ts`: 2 tests, tool_call bridge refusal text | same 2 fail | same 2 fail; tracked in #13522 |
| `Runtime Broker and Managed Agent MariaDB / Java 21` | job hit the 15-minute ceiling and was cancelled | — | main's own run of this job at `ac81c07d` (37496091771) was cancelled at 15 min too |
| same lane's unit suite | `ManagedSessionStoreIntegrationTest.holdsRestorePagesInsideThePerPageByteBudget` → 409 "Record line 1 is not an event line, yet it sits among the transaction's events." | same error (head and trial merge) | same error |

The store test failure is a merge-order collision on main. #13348 added the test at 15:51, and #13355 added the stricter line check at 16:29. The PR touches none of these files, and its merge commit matches git's automatic merge. I found no existing issue for the store test yet; main's failure bot may file one.

![CI attribution](IMG2)

### Still open, not blocking

- **J9 (pre-existing since before this PR):** the expression that nulls `task_state` for non-task rows is not pinned by any test.
- **The H4b delivery-vs-acceptance direction:** recorded in the design's follow-up table, and behaviour is unchanged.

**Rig and raw results:** `RIGLINK`.
