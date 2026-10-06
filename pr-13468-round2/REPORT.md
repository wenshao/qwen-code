## Maintainer verification, round 2 (delta) — PR #13468 @ `1a02ab1`

**Verdict: still ready to merge.** `1a02ab1a5d` changes only tests: every non-test file is byte-identical to `0507359`, which [round 1](https://github.com/QwenLM/qwen-code/pull/13468#issuecomment-6006819707) verified end to end. The new assertions close the two test gaps from round 1, and I confirmed by mutation that each one catches the regression it targets. I agree that round-1 note 2 belongs in its own follow-up: the busy parent's in-flight prompt also ends up in side tasks on `main` today.

![Round 2 mutants and the real-daemon SSH probe](./fig-r2-mutations.png)

### Do the new tests catch the regressions?

Each mutant edits one production file. I ran the pinning test, then restored the file and confirmed it matches `git show HEAD` byte for byte (`cmp`).

| Mutant | Result |
|---|---|
| M0: no mutation (control) | All three targeted tests pass |
| M1: swap `(route, sessionId)` at the owner-wrapper call site, `session.ts:1976` | **Caught.** The side-task iteration fails, and the diff shows `route`/`sessionId` exchanged |
| M2: the same swap at the restricted-wrapper call site, `session.ts:2873` | **Caught.** The branch iteration fails |
| M3: remove `sessionSideTask` from the ACP child's SSH deny-list (`ssh-workspace-guards.ts`) | **Caught.** The new assertion at `acpAgent.test.ts:7603` fails, and so does the existing `ssh-workspace-guards.test.ts` predicate test |

I also ran M3 against a real daemon, which shows the child guard really is the only layer:

- With the PR bundle, a real `ssh://` workspace rejects `POST /session/:id/side-task` with 400 `unsupported_operation`, and no child is created.
- With the M3 bundle, the same request returns **201**, and the child shows up in the side-task catalog.

So the new `acpAgent` assertion now guards the one place that enforces the SSH exclusion, and round-1 note 1 is covered against regressions. The author chose to keep the current 400 `unsupported_operation` contract rather than add a route-level 501. I'm fine with that, since it is now pinned.

### Re-run on the `1a02ab1` build

- **Bundle equivalence.** I rebuilt the bundle at `1a02ab1` and compared it with the round-1 bundle. After normalising the embedded commit hash and the content-hashed chunk names, all 957 files are identical.
- **Real-daemon E2E, re-run on the new bundle anyway.** All results match round 1:
  - **API matrix:** the secondary-workspace side task returns 201 with an idle and with a busy parent; the child inherits context; parent and sibling stay isolated; the catalog is scoped to the right workspace; primary, unknown-owner, branch and fork behave as before.
  - **Restart and restore:** after a daemon restart, `load` returns the same child id, with no duplicates.
  - **Browser:** a side task while the parent is busy, then a daemon restart, a cold reopen, and a close plus reopen, with 0 new creates.
  - **SSH:** still 400 `unsupported_operation`.
- **Tests at `1a02ab1`:** `server.test.ts` 1370/1370, `acpAgent.test.ts` 842/842, `multi-workspace-sessions.test.ts` 176/176.
- **Merge:** still clean against `main` (`69d5db2`, unchanged since round 1).
- **CI on `1a02ab1`:** 26 success, 37 skipped, 0 failed. Only the `review-pr` bot job was still running when I posted this.

![Round 2 re-run on the 1a02ab1 bundle](./fig-r2-rerun-at-1a02ab1.png)

Evidence (mutant logs, harness, raw JSON, screenshots): this directory (`mutants/`, `harness/`, `data/`, `screens/`).
