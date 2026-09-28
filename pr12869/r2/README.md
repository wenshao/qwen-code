# PR #12869 (W0e-3) real-host verification, round 2

Verified head: `9a1de09e` (W0e-3 and W0e-2 commits patch-identical to round 1; new base, rebuilt bundle).
Round 1 is one directory up (`pr12869/`); scripts that did not change are only there.

- `r2-0{1,2,3}-*.png`: evidence figures used in the PR comment.
- `harness/host/`: host-side orchestration. `run-r9.sh` power cut with the two controls, `run-r10.sh` reboot plus crash
  injection (R10 plain, R12 to R14 with the trigger), `run-r15.sh` hands-off reboot on the rebased jar, `run-f1.sh`
  healthy traffic and the Hosted chain, `v3-run.sh` / `rebased-run.sh` / `ab-rebased.sh` Maven jobs.
- `harness/vm/`: scripts that changed or are new in this round (`s10-interrupt.mjs` installs the trigger and places the
  crashes, `s2i-second-session.mjs` checks the new base behaviour).
- `harness/mut/run5.sh`: one pipeline per mutant (unit suites, two gate classes, real-worker IT, both MySQL ITs).
- `harness/candidate/`: the F1 candidate re-applied to `9a1de09e`, its test, and `RebootRecoveryGapTest`.
- `results/`: raw output of every run quoted in the comment.

R12 and R13 are earlier attempts at the crash injection: R12's second kill hit a server that was still starting, R13's
second kill hit a server that was not inside a retirement. Both converged; R14 is the run with both kills inside a held retirement.
Tokens, passwords and keys in these files were generated for the rig and guard nothing.

`results/mutation/`: `parallel-*` ran two pipelines side by side on the loaded machine; its BASE row is red only through the
flaky `ManagedAgentServerIntegrationTest`, and the M16 / M21 rows are load flakes (their failing tests cannot see those
mutants). `sequential-confirmation.*` is the same pipeline alone on the quiet VM: baseline green, M16 and M21 survive.
