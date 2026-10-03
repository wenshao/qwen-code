# PR #13166 real-stack verification, round 2 (head 1130745c)

Same rig as round 1 (`../README.md`). Harness and Runtime worker rebuilt from `1130745c` (`dist/head2`);
the server jar is reused (no Java change since `b2a28c4f`). `cand2` = head + `candidate-brace-bound.patch`.

| DB | Runtime worker | Scenarios |
| --- | --- | --- |
| g6 | head2 | regression `run-r2.sh` (S1–S6, S9), S11 delta (Harness head vs head2), S12 maintainer items (/1, /2, /2 without the loop link), S13 brace cost/cancel + S13b aftermath + S13c no-cancel, S14 R1-1 count |
| g7 | main (b3dda468) | S12 /1 main arm (R4-2, R3-1 write side, R4-10) |
| g8 | head (b2a28c4f) | S11 R4-9 old-worker arm |
| g9 | cand2 | S15 brace bound: candidate Harness + worker, and old (head2) Harness + candidate worker |

- `mutation/` — delta mutants D1–D5 (each reverts one round-5 fix) with per-file baselines; `mutate-r2-run.log`
  stopped at D2 because that run hung (no summary); the script now restores before aborting and D2–D5 were rerun
  in `mutate-r2-run2.log` with `--testTimeout=30000` for D2.
- `workspace-recovery-session.r41v2.test.ts` — the unmodified `verifyRecoverySession` fixture with `files/2`; `r41v2-run.log`.
- `brace-calibration.txt` — local glob timings for `{a,b}`×N and `{1..N}` patterns (`probe/brace-cal*.mjs`).
- S6's two failures are the `captureBytes` publisher case: this rig has no OSS publication backend (round 1, S6b).
