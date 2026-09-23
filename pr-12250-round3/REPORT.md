## Local verification, round 3: head `fe6ca099f6`

Since my [round-2 report](https://github.com/QwenLM/qwen-code/pull/12250#issuecomment-5775790237) at `02665c2cf7`, the branch added two test-only commits (`bridge.test.ts` +88/−16). There was no `main` merge (the merge-base is still `97b1b252e3`), and production code is still untouched. The commits are:

- a queued-cd timing table that holds the queue with an unresolved `cd` (the bot's R4-1);
- `expect(conditionalCloseCalls).toBe(1)` after the release (R4-2, the line I measured in round 2 §5);
- rewrites of both comment blocks.

I rebuilt the head, re-ran the whole-suite mutation matrix with the new tests, and ran the new table's scenario on a real `qwen serve` with a real ACP child.

**Verdict: mergeable. I found no blocking issue.**

- **Both new pins are real.** The new table is the first test that catches removal of the branch or fork admission term on its own. On the real stack, that term is what stops a branch or fork from running after the caller has already given up (§1, §2).
- **The bot's four deferred items on this head are all correct as stated.** I reproduced R5-2, R5-3 and R6-1 by execution (§3). One patch of +20/−7, test-only, closes all four and is verified below. I'd take it in this PR, but it does not block.
- **Checks pass.** Head and head merged with current `main` are green, and eslint, prettier and tsc all exit 0 (§4).

### 1. What the new commits buy

I ran the whole `packages/acp-bridge` suite once per production mutant, with identical production code in every column.

![mutation matrix](images/fig1-mutation-matrix-r3.png)

- **The queued-cd table works.** Removing branch's admission term alone (M3), or fork's alone (M6), now fails its row with `expected 'queued-timeout' to be an instance of …`. With the round-2 tests both survived. This closes R4-1.
- **The R4-2 line is live.** M15 makes the release close the session without asking the child. The round-2 retention test passes under M15, while the head version fails with `expected +0 to be 1`. The suite already catches M15 through 24 other tests, so this line pins *this* test's claim; it is not the only guard.
- **What still survives is what the description declares:** the two queue-callback terms (M4, M7). Two further survivors are the subject of §3: M16 and M17.
- **The new table is stable.** The timing table (with the patch's extra `rewind` row) and the retention test passed **20/20** runs with 8 CPU-burning processes alongside, with load around 9.4 on 16 cores. The 100 ms race is not tight: an intact admission guard rejects before any timer can fire.

### 2. Real stack: the scenario the new table models

The new fixture has a `cd` in flight when the background turn is admitted. I checked that the product can reach this state. `start_turn` admission (`session-control-plane.ts`, the `onBackgroundTurnStart` hook) checks prompts, goal turns and resets, but not the prompt queue. I then built it on the real stack:

- the child holds a `cd` for 12 s, via one instrumentation line in the head bundle;
- the background agent finishes, and its notification turn (a silent 25 s shell) is admitted;
- the client sends `branch`, `fork` and `rewind`, each with a 5 s timeout.

There are two arms. The first is the head bundle. The second removes the branch and fork admission terms and moves rewind's term into its queue callback, leaving every callback guard intact.

![real stack A/B](images/fig2-real-stack-queued-cd.png)

- **Head (3/3 runs):** all three requests get 409 in 2–4 ms, and nothing is dispatched to the child.
- **Admission terms off (3/3 runs):** all three requests hit the client timeout. The `cd` does not return until the turn ends (28.4 s; the real `cd` also waits for the turn), and by then the callbacks' `backgroundTurn` check has nothing to see. So all three requests are dispatched *after* the caller gave up:
  - a branch session is created;
  - a fork agent runs and posts its notification into the parent's history.
- **Rewind does no damage in this scenario, for an unrelated reason.** The late rewind reaches the child, which refuses it with `invalid_rewind_target`. The `cd` holding the queue drops the rewind snapshots: on an idle session, `cd` followed by `rewind` returns 400. So this particular setup cannot show a late truncation, and I am not claiming one. The branch and fork effects are the concrete cost of losing the admission placement.

### 3. The open deferred items, measured (all non-blocking)

| Item | Measured at `fe6ca099` |
| --- | --- |
| **R5-1** comment accuracy | Improved, but still hard to read. "rewind's admission disjunct and the queued-cd table below pin branch and fork admission individually" reads as if rewind's disjunct pins branch. Also, the cited `session-control-plane.ts:10836` / `:13674` are already at `:10852` / `:13690` on current `main` (+16 lines). Symbol names would not drift. |
| **R5-2** rewind placement | Confirmed. M16 moves rewind's `backgroundTurn` term into its queue callback, and **the whole suite passes** (2260/2260). Adding a `rewind` row to the queued-cd table catches it: `expected 'queued-timeout' to be an instance of SessionBusyError`. §2 shows that the same class of change for branch and fork has real effects. |
| **R5-3** test name | Confirmed. With the fixture edited to match the current name (the `cd` resolved and awaited before admission), both M3 and M6 **survive** (2260/2260). The name invites exactly the edit that makes the table useless. |
| **R6-1** projection | Confirmed. M17 makes `entryActiveWorkState` stop counting the background turn while retention stays intact. It **survives the whole suite**, so a detached session with a running turn would show `idle` in the sidebar. One assertion catches it: `expected 'idle' to be 'active'`. This is the `activeWorkState` check that #11768's R1-16 fix asked for. |

<details>
<summary><b>Proposed patch (+20/−7, test-only), verified</b></summary>

```diff
diff --git a/packages/acp-bridge/src/bridge.test.ts b/packages/acp-bridge/src/bridge.test.ts
index b63294350d..ce1a1af056 100644
--- a/packages/acp-bridge/src/bridge.test.ts
+++ b/packages/acp-bridge/src/bridge.test.ts
@@ -481,12 +481,13 @@ describe('createAcpSessionBridge', () => {
     // admission and queue callbacks had no test — the existing busy-guard
     // table only ever produced the busy state with an in-flight prompt. An
     // admitted background notification turn is a different way to reach the
-    // same guard. The pins are per-arm: rewind's admission disjunct and the
-    // queued-cd table below pin branch and fork admission individually. The
-    // branch/fork queue-callback disjuncts (`session-control-plane.ts:10836`,
-    // `:13674`) remain masked by their own admission checks and are the
-    // residual R1-17 gap. The side-task term (`concurrentSideTask` in
-    // `session-control-plane.ts`) is a concurrent-release decision and is not
+    // same guard. The pins are per-arm: this table pins the rewind admission
+    // disjunct and the cd guard individually; the queued-cd table below pins
+    // the branch, fork and rewind admission disjuncts individually, and their
+    // placement before the queue. The branch/fork queue-callback disjuncts (in
+    // `branchSession` and `launchSessionForkAgent`) remain masked by their own
+    // admission checks and are the residual R1-17 gap. The side-task term
+    // (`concurrentSideTask`) is a concurrent-release decision and is not
     // pinned here.
     const admittedBackgroundTurn = {
       turnId: 'notification-1',
@@ -577,6 +578,12 @@ describe('createAcpSessionBridge', () => {
           bridge.branchSession(sessionId, {}),
         errorType: BranchWhilePromptActiveError,
       },
+      {
+        operation: 'rewind',
+        invoke: (bridge: ReturnType<typeof makeBridge>, sessionId: string) =>
+          bridge.rewindSession(sessionId, { promptId: 'prompt-1' }),
+        errorType: SessionBusyError,
+      },
       {
         operation: 'fork',
         invoke: (bridge: ReturnType<typeof makeBridge>, sessionId: string) =>
@@ -584,8 +591,11 @@ describe('createAcpSessionBridge', () => {
         errorType: SessionBusyError,
       },
     ])(
-      'rejects $operation synchronously before a queued cd can dispatch during a background turn',
+      'rejects $operation synchronously instead of queueing behind an in-flight cd during a background turn',
       async ({ invoke, errorType }) => {
+        // `hangingCd` must still be unresolved when the operation is invoked:
+        // with a settled queue the queue-callback guard rejects inside the
+        // race window too, and the admission-disjunct mutation goes unseen.
         const hangingCd = deferred<Record<string, unknown>>();
         const handle = makeChannel({
           extMethodImpl: (method) =>
@@ -682,6 +692,9 @@ describe('createAcpSessionBridge', () => {
       await new Promise((resolve) => setTimeout(resolve, 40));
       expect(conditionalCloseCalls).toBe(0);
       expect(bridge.sessionCount).toBe(1);
+      expect(bridge.getSessionSummary(session.sessionId).activeWorkState).toBe(
+        'active',
+      );
 
       await handle.agentConnection.extNotification('_qwencode/end_turn', {
         sessionId: session.sessionId,
```

- Applies cleanly to `fe6ca099`. `eslint --max-warnings 0`, `prettier --check` and `tsc --noEmit` (the package tsconfig covers tests) all exit 0.
- The whole package passes: 2261/2261. On head merged with `main` `64ac2faae7`, 2316/2316.
- Mutants caught with the patch: M2, M3, M6, M9, M10, M16 and M17, each by the intended test. Only the declared M4 and M7 survive.
- The 20× under-load run in §1 used this patch's test code. It ran before the last edit, which changed comments only.

</details>

### 4. Tests, lint, CI

| | |
| --- | --- |
| Whole `packages/acp-bridge` at head | **2260 / 2260** (the merge-base test files give 2252) |
| Head merged with `main` `64ac2faae7` (clean merge) | **2315 / 2315** |
| The PR's own command (`-t "background"`) | **45 passed** / 1072 skipped, matching the description |
| `eslint --max-warnings 0`, `prettier --check`, `tsc --noEmit` on the two test files | exit 0 |
| Build | `npm run build && npm run bundle` at head, exit 0. Linux x86_64, Node 22.22.2, real `pnpm install --frozen-lockfile`. |

CI at `fe6ca099`: `Lint & Static`, `Integration Tests (no-AK)`, the Java jobs and Desktop Shell have passed. `Test (ubuntu-latest, Node 22.x)` is still running (attempt 2, started 17:09 UTC) as I post this. Round 2 §4 covers the `main`-side cause if it goes red the same way.

Evidence (harness, per-run JSON, bundle diffs of both arms, matrix summary with source hashes, the patch): this directory
