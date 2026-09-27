# PR #12830 verification evidence (head 6a1ec766)

- `01..04-*.png`: figures used in the PR comment.
- `harness/`: probe and matrix scripts (Node 24, Ajv 2020 from the repo's node_modules). Paths are placeholders:
  `$HEAD_WORKTREE` / `$BASE_WORKTREE` / `$MUT_WORKTREE` are worktrees at 6a1ec766 / 8a170d7e / 6a1ec766, `$SCRATCH` a scratch dir.
  `harness/mutants/*.sh` are the apply scripts for `run-mutant.sh` (probe controllers, spec edits, the cancel-replay probe test).
- `candidate/`: `candidate-all.patch` = `candidate-route-guard.patch` (test, +7/-4) + `candidate-units-replay.patch`
  (spec descriptions + design note EN/zh-CN). Applies cleanly on 6a1ec766 (`git apply`).
- `output/`: raw outputs quoted in the comment.
