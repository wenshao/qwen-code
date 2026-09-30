# PR #13083 verification evidence

- `01-…06-*.png`: the cards embedded in the report.
- `candidate.patch`: candidate for F2 and F3, applies to `13cbd974`.
- `harness/`: everything used to produce the results.
  - `rig/stack.ts`: driver (private mysqld, Spring fat jar, Hosted Harness bundle, scripted model, tap proxies).
  - `rig/s1-two-turn.ts`, `rig/s1c-stream-gap.ts`: later Turns and re-entered Turns on a live owner (F1).
  - `rig/s2-takeover.ts`: owner failover with fault injection, file-system watcher, second-Session probe (F2, F3, F4).
  - `rig/s5-actor.ts`, `rig/s6-stream-volume.ts`, `rig/s7-mixed-version.ts`: actor header, delta cost, rollback (F5).
  - `mut/`: mutants and their drivers. `batch-*.sh`: the order things were run in.
  - `apply-cand-h5.mjs`: applies the candidate to a tree at `13cbd974`.
- `results/`: raw result JSON and consoles. Label prefixes name the arm:
  - `h5-` = PR head `13cbd974`; `h5cand-` = `13cbd974` + candidate.
  - `h4-` = previous head `fcd2dc2c`; `h4cand-` = `fcd2dc2c` + the earlier candidate.
  - `new-`, `new2-` = head `1606fe07`; `cand2-` = `1606fe07` + the earlier candidate; `candA-` = `1606fe07` + connector fix only.
  - `base2-` = `main` at `3b18cfe5`.
- `results-first-head-eb06f7f9/`: the same scenarios on the first head (`pr-`, `pr2-`, `cand-`, `candBC2-`, `base-` = `main` at `e263741e`).
