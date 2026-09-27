# PR #12831 round-3 verification (head c6c767507f)

Same rig; Harness/worker bundle rebuilt at c6c76750 (jar unchanged: the commit touches only cli + docs).
- `rig/s7-r2-probes.ts` Q1 dense-CJK read (F3), Q2/Q3 unchanged lifecycle cases, Q4 90 KB final answer after a tool batch.
- `rig/s8-real-cjk.mjs` real model reads docs/design/2026-09-10-opentui-parity-defect-sweep.zh-CN.md.
- `rig/s9-notool-bigfinal.ts` control: 90 KB final answer on the default no-tool path (ARM=r2 and ARM=base).
- `mutate-r4.py` / `mutants-r4.txt` mutation sample on the F3 fix.
