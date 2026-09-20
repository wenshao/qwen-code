# PR #11792 — maintainer verification evidence

Figures referenced from the verification report on
[QwenLM/qwen-code#11792](https://github.com/QwenLM/qwen-code/pull/11792).

| File | What it shows |
| --- | --- |
| `pr11792-equivalence-matrix.png` | 1,002 real-filesystem cases, BASE (origin/main `8589f71331`) vs MERGE (main + PR, `5311444064`) — zero divergence |
| `pr11792-mutation-matrix.png` | Nine mutations of the privacy gate; which arm's suite notices |
| `pr11792-windows-three-arms.png` | Full `packages/qwen-live` suite on a real `windows-2022` runner, three arms |
| `pr11792-retention-scope.png` | Retention sweep scope, POSIX vs forced `win32`, both arms |

`data/` holds the raw counts, the mutation transcript and the Windows run's JSON summary.
`probes/` holds every probe, the mutation harness and the Windows workflow, so the run is reproducible:

* drop the four `zz-probe-*` files into `packages/qwen-live/src/` on each arm and run them with vitest;
* `mutate.sh <arm-worktree> <label>` applies one mutation, runs the PR-touched suites and restores the tree with git;
* `zz-pr11792-windows-probe.yml` is the branch-triggered workflow that produced the Windows numbers
  (run [35487751521](https://github.com/wenshao/qwen-code/actions/runs/35487751521)).
