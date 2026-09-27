# PR #12831 round-2 verification (head 25749df400)

Same rig as `../harness` (round 1) with: fresh MySQL schema `rig3` (Flyway V13), jar and worker bundle built from
25749df4 (`JAR_ARM=r2 WORKER_ARM=r2`), Broker token `hosted-tools-broker-token` so the PR's own driver runs unchanged.

- `s7-r2-probes.ts` Q1 dense-CJK `read_file` (F3), Q2 Store 503 on the assistant commit (Harness->Store proxy),
  Q3 definite `:start` refusal (payload bytes rewritten by the Harness->Broker proxy). `ARM=r2|cand2`.
- `s7b-busy-confirm.ts` new Session per affected Workspace -> `workspace_busy`.
- `s8-real-cjk.mjs` real model reads `docs/design/2026-09-10-opentui-parity-defect-sweep.zh-CN.md`.
- `candidate-r2-settled-output.patch` apply on 25749df4 (F3 + bot findings 1 and 2).
- `mutate-r2.py` / `logs/mutants-r2.txt` mutation sample on the round-2 fixes.
