## Real-environment verification, round 3: `3261e4d4`

**Verified head:** `3261e4d4`, which is the round-2 head plus two commits:
- `0aa09f1c`, a merge of main `ac81c07d`. I recomputed it with `git merge-tree`: its tree is byte-identical to git's own automatic merge, so there are no hand-resolved hunks.
- The F3 commit.

**Trial merge:** `3261e4d4` merged into current main `ac497aee` (2 more commits). Same rig as before: Spring Session Store on native MySQL 8.4.7, the real TS authority over HTTP, and a raw-HTTP second writer.

### Verdict

**Ready to merge from this PR's side.** F3 and F4 landed exactly as verified in round 2, and every round-1 and round-2 check still holds on the head and on the trial merge. The two red CI legs on `3261e4d4` reproduce on main without this PR, so they will clear with main.

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
