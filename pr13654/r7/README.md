# PR #13654 round 7: head `876b00ef` against `main` `e9789d09`

The head is unchanged since round 6 (`../r6/`). This round checks only the four `main` commits that landed after round 6's merge check against `aaf97b86`.

The trial merge `74bab6a5` is a local `git merge` of `876b00ef` and `e9789d09`. It has no textual conflicts and was never pushed. Its ids are in `results/trial-merge-ids.txt`.

## Files

- `01-main-sync.png`: the four arms and the rest of the trial merge. Its source is `harness/01-main-sync.txt`, rendered with round 6's `render.mjs`.

## Harness

- `harness/node-arms.sh` runs three files with vitest from `packages/cli` on four arms:
  - A is the PR head;
  - B is `main`;
  - C is the trial merge;
  - D is C with `main`'s copy of `hosted-never-started-reconcile.test.ts`.
- `harness/reconcile-repeat.sh` runs `hosted-never-started-reconcile.test.ts` alone, three times per arm.
- `harness/typecheck-merge.sh` runs `tsc --noEmit` for cli and core on the trial merge. `harness/typecheck-main.sh` is the cli control on `main`.
- `harness/trial-merge-java.sh` runs the `managed-agent-server` module verify on the trial merge, the same way as round 6's `trial-merge.sh`.
- `harness/linked-worktree-control.sh` reruns the module run's second `ChildWorktreeGitTest` failure on its own, four times with the default git config and four times with git background maintenance off.

Every script checks out detached commits in an existing worktree, then restores the PR head or round 6's trial merge.

## Results

- `results/shell-gate-conflict.txt` holds:
  - both sides' edits since merge-base `b1b2b2c6`;
  - the merged mock and assertion;
  - the trial merge compared with `main` for that file;
  - the `sdk-java` delta from round 6's trial merge;
  - the failure.
- `results/reconcile-repeat.txt` holds the three runs per arm.
- `results/node-arms.txt` holds the first pass. `results/node-arms-logs/` has the test lines from each arm's run.
  - `hosted-harness-session.test.ts` failures there vary by arm, including on `main` (B), at load about 160 on 10 cores.
- `results/pr-ci-checkout.txt` shows that the PR's `Qwen Code CI` run checked out `876b00ef` at 08:20, before #13959 merged.
- `results/typecheck.txt` holds the cli and core typecheck results.
  - The 25 cli error lines are identical on `main` and on the trial merge.
  - They come from this machine's stale core `dist` (TS6305), in `main`'s new mods files.
- `results/trial-merge-java.txt` holds the module verify on the trial merge.
