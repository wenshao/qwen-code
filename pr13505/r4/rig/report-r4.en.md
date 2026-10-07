## Real-environment verification, round 4: `e4b7f0fc`

**Verified head:** `e4b7f0fc`. It is the fix commit `27ba5c26` plus a merge of main `ac497aee`; that merge's tree is byte-identical to git's own automatic merge.

**Trial merges:**
- **m4:** into main `f3385785`, the latest at the start of this round.
- **Latest main `a764fb96`**, Java only. It carries #13551, which fixes the main-red store test from round 3.

**Rig:** the same as before. Spring Session Store on native MySQL 8.4.7, the real TS authority over HTTP, and a raw-HTTP second writer, so the Java store decides alone.

### Verdict

**The code is ready to merge.** Every finding the two reviews marked blocking is fixed: R1-1…R1-4 and yiliang114's two P1s. Both P2s are fixed too.
- Each fix is in TS and Java with the same refusal message, and verified on the real stack on the head and on the trial merge.
- TS and Java agree on all 1.22M differential rows.
- Every new rule is pinned: removing it turns a PR test red.

**Before merging:**
- **Both CHANGES_REQUESTED reviews are still standing:** the bot's on `0a1b1d2e` and yiliang114's on `3261e4d4`. A reviewer has to clear each.
- **Merge current main once more.** The two red Java lanes on this head are main's. #13551 fixed the test on main, and with `a764fb96` merged the Java suite is fully green locally: 1047 tests, 0 failures, 0 errors; ITs 53/53.
- **Note the merge order with three related PRs** (end of this comment).

### The fixes, on a real stack

I built each chain so that the new rule is the only reason a revision fails. TS = the real authority; Java = the raw-HTTP writer.

| Rule | h4 TS | h4 Java | m4 TS | m4 Java |
| --- | --- | --- | --- | --- |
| Definition pin at dispatch (R1-3 / P2) | refused | 409 | refused | 409 |
| Runtime binding for an attached child Session (R1-2 / P1) | refused | 409 | refused | 409 |
| Drive-qualified `workingDirectory` (R1-4 / P1) | refused | 409 | refused | 409 |
| First-level child: `rootSessionId` ≠ this Session (new rule) | refused | 409 | refused | 409 |

- **Controls:**
  - A depth-2 child with a foreign root commits (TS) and gets 200 (Java). So does a depth-1 child whose root is its own Session.
  - Every Session reopens.
  - The refusal message is identical on both sides.
- **Runtime (yiliang114's "can settle with no Runtime binding"):** the head uses the narrower guard (a Session id needs a binding). I checked every ending a run dispatched with `runtime: null` can still reach, in both languages:
  - **Reachable:** only never-started endings (`creation_failed` / stop with `not_started_proven`) and `recovery_blocked`.
  - **Refused:** `running_attached`, `settled/completed`, `failed/child_failed`, and a cancel after starting.
  - So such a run can no longer settle.
- **`resultVersion: 1e400`:** the Java finiteness guard is in. Over HTTP the store's reader still refuses non-finite numbers first (409), so both paths answer cleanly.
- **R1-1 restore:** the PR's new test (`restores a Session whose detached lineage sits beside a child agent record`) fails when the parser is reverted to `parseChildShellRun` (`expected 409 to be 200`). The `child_agent` skip line itself is defensive only: `parseChildRun` already lets the record through, and it carries no `outputRef`.

![round 4 fixes](IMG1)

### Parity, cross-version behaviour, mutants

- **Differential, TS ↔ Java:**
  - 644,324 rows seeded from this round's fixtures, plus the 573,903-row round-1 corpus.
  - **0 disagreements** on the head and on the trial merge.
  - The remaining message differences are the same 108 wording-only pairs as in round 2.
- **Cross-version, `3261e4d4` → `e4b7f0fc` on the same corpus (TS and Java agree):**
  - The only verdict changes are the new refusals: 22 runtime and 5 definition.
  - **Shell bodies: 0 verdict changes.** The stop-reason dedupe changes only which clause a doubly broken shell body reports first, and Java mirrors that order.
  - **Successor pairs: 0 verdict changes.** Removing the result/receipt set-once rule changed no transition.
- **Real stack:** all 23 round-1…3 probe rows are identical to round 3.
  - Settling-revision closure: 409 / 409 / 200.
  - The delivery-vs-acceptance behaviour is unchanged; it is recorded for H4b.
- **Mutants (PR suites, on `e4b7f0fc`):** 32/33 killed. The survivor is the pre-existing J9.
  - Every round-4 rule is killed in both languages: definition, runtime, drive, rootSessionId binding, and both Java finiteness guards.

![parity and suites](IMG2)

### Suites

SUITES

### Merge order with related PRs

- **#13550 (H4b) is stacked on this branch.** After #13505 is squash-merged, retarget #13550 to `main`. Expect conflicts there in files both PRs touch.
- **#13536 (H6a) and #13548 (H5a, draft) target `main` and conflict with this PR in the record-body registry.** Their new contract tests also call `Body.taskKind()`, which this PR replaces with `taskKindOf`:
  - `ManagedAutomationRecordContractTest.java:49-50` in #13536.
  - `ManagedChannelRecordContractTest.java:27` in #13548.
  
  Those files merge cleanly but will not compile, so whichever lands second must switch to `taskKindOf`.

### Still open, not blocking

- **Windows device names and trailing dots/spaces** (`CON`, `NUL.txt`, `childA.`) are still accepted. The author defers them to H4b's workspace-bind step, which resolves against the real filesystem; that reasoning holds. One caveat: `workingDirectory` is a frozen key. Tightening the string rule later is free only before H4b enables `child_run`; after that, records already written would stop parsing.
- **J9** (pre-existing) and the **H4b delivery-vs-acceptance direction** (recorded in the design) are unchanged.

**Rig and raw results:** `RIGLINK`.
