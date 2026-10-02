# PR #13138 — real-environment verification, round 2

Heads `52899c07` (b1cf9df3 F1/F2 fixes + CI repairs + main a7deb01b) and `0919b9d8` (fixes for the bot review on b1cf9df3), same Linux VM rig as round 1 (one directory up).

| Path | Content |
| --- | --- |
| `0*.png` | Cards embedded in the round-2 comment, rendered from `harness/fig/cards-r2.mjs`; every value comes from `results/`. |
| `results/e2e-r2/` | 52899c07: `r2-matrix.*` (runbook smoke, F1 matrix, R1-29/30/31/32, wait_timeout), `s8-ab-r2.*` (F2 timing, 20,522 entries), `r2-d-old.*` (wait_timeout on the 989baf22 jar), every maintenance command's request/stdout/stderr (`w1b-*.txt`). |
| `results/e2e-r3/` | 0919b9d8: the same matrix (`r2-matrix-r3.*`), `s5-interrupt.*` (4 kill points + request checks), `s7-real-oss.*` (real Aliyun OSS; bucket redacted). |
| `results/unit-*.log`, `results/it-r3.log` | CLI W1b tests on both heads; my R1-29/30/31 tests red on 52899c07 and green on 0919b9d8; WorkspaceRecoveryStoreTest + WorkspaceRecoveryMySqlIT on MySQL 8.4.11. |
| `cand-r2-criticals.patch` | My candidate for R1-29/30/31/32 written before 0919b9d8 appeared (reference only; 0919b9d8 implements the same behaviour, R1-32 as a LocalDateTime string). |
| `harness/` | Scenario scripts used this round (`r2-matrix.mjs`, `oddname.mjs`, `r2-d-old.mjs`, updated `w1b.mjs` with a JVM time-zone option, `run-it.sh`). |
