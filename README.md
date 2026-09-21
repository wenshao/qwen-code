# assets-pr12374

Evidence for the local verification of **QwenLM/qwen-code#12374** — *fix(cli): clean up stale session debug logs*.

Verified tree: `origin/main af4e3b298e` + PR head `ae8fd0a5` merged (`b7544b673f81ed98817a299e41c80aa7feb0fc8c`).

- `images/` — the figures embedded in the PR comment.
- `evidence/` — raw before/after directory snapshots per arm, and the mutation matrices.
- `harness/` — the scripts that produced them.

Arms:

| arm | bundle | what it shows |
| --- | --- | --- |
| `base` | `origin/main` | nothing swept, no marker |
| `head` | main + PR | stale session logs swept, everything else kept |
| `race-head` / `race-mut` | main + PR | `latest` left dangling after its target ages out |
| `frozen-head` / `frozen-mut` | main + PR, one token differs | the current-session guard is load-bearing |

## Round 2 (head `b83983c19`, merged into `main df3f9732a6` → `f570314d89`)

- `images/r2-*.png` — round-2 figures.
- `evidence/r2/` — per-arm snapshots on the new tree and both mutation matrices.
- `harness/run-testfile-ab.py` — same mutants against the old vs new `cleanup.test.ts`.
