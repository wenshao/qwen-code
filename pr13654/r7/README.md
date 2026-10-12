# PR #13654 round 7: head `876b00ef` against new `main`, then the landed squash `9f14e7d9`

The head did not change after round 6 (`../r6/`). This round started on the four `main` commits that landed after round 6's merge check against `aaf97b86`. While it ran, the PR was squash-merged at 13:02Z as `9f14e7d9`.

The trial merge `74bab6a5` is a local `git merge` of `876b00ef` and `main` `e9789d09`. It had no textual conflicts and was never pushed. Its ids are in `results/trial-merge-ids.txt`.

The landed tree `630f809c` equals `git merge-tree b675c974 876b00ef`, and its `sdk-java` equals the trial merge's.

## Files

- `01-main-red.png` shows four things:
  - the four arms on the trial merge;
  - current `main` after the landing;
  - #13983's fix compared with restoring #13959's copy;
  - mutant G.
- `02-landed.png` covers the landed code: Java, TypeScript and the packaged stack.
- The card sources are `harness/01-main-red.txt` and `harness/02-landed.txt`. Round 6's `render.mjs` renders them.

## Harness

- `harness/node-arms.sh` runs three files with vitest from `packages/cli` on four arms:
  - A is the PR head;
  - B is `main`;
  - C is the trial merge;
  - D is C with `main`'s copy of `hosted-never-started-reconcile.test.ts`.
- `harness/reconcile-repeat.sh` runs `hosted-never-started-reconcile.test.ts` alone, three times per arm.
- `harness/guard-mutant.sh` works on current `main` `96076f3a`.
  - It runs #13983's copy and #13959's copy of that file, with and without mutant G. G removes the child-run kind-gate call in `ManagedSessionAuthority`.
  - Under G it also runs the core authority tests and the cli child-run files.
- `harness/typecheck-merge.sh` runs `tsc --noEmit` for cli and core on the trial merge. `harness/typecheck-main.sh` is the cli control on `main`.
- `harness/trial-merge-java.sh` runs the `managed-agent-server` module verify on the trial merge, the same way as round 6's `trial-merge.sh`.
- `harness/linked-worktree-control.sh` reruns the module run's second `ChildWorktreeGitTest` failure alone:
  - four times with the default git config;
  - four times with git background maintenance off.
- `harness/build-land.sh` builds the landed commit's jar and node dist.
- `harness/stack-land.sh` and `harness/r11.sh` run round 6's 13 stack scenarios on that build, starting from a fresh schema. The other rig scripts are in `../r6/harness/rig/` and `../r5/`.

Every script that checks out a commit uses detached checkouts in an existing worktree and then restores the previous commit.

## Results

- `results/shell-gate-conflict.txt` holds:
  - both sides' edits since merge-base `b1b2b2c6`;
  - the merged mock and assertion;
  - the trial merge compared with `main` for that file;
  - the `sdk-java` delta from round 6's trial merge;
  - the failure.
- `results/reconcile-repeat.txt` holds the three runs per arm.
- `results/node-arms.txt` holds the first pass. `results/node-arms-logs/` has the test lines from each arm.
  - `hosted-harness-session.test.ts` failures there vary by arm, including on `main` (B), at load about 160 on 10 cores.
- `results/guard-mutant.txt` and `results/guard-mutant-logs/` hold:
  - the two fixes with and without G;
  - the other tests under G;
  - the file failing twice on current `main` as landed.
- `results/pr-ci-checkout.txt` shows that the PR's `Qwen Code CI` run checked out `876b00ef` at 08:20Z, before #13959 merged.
- `results/typecheck.txt` holds the cli and core typecheck results.
  - The 25 cli error lines are identical on `main` and on the trial merge.
  - They come from this machine's stale core `dist` (TS6305), in `main`'s new mods files.
- `results/trial-merge-java.txt` holds the module verify and the linked-worktree control.
- `results/stack-land-r1-r13.log`, `results/stack-land-objcheck.txt` and `results/stack-land-vs-876b00ef.txt` hold the packaged stack on `9f14e7d9`.
