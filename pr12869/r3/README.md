# PR #12869 (W0e-3) real-host verification, round 3

Verified head: `8c2b626c74f88fd39ffffd3e168099cab488041d` on a fresh aarch64 KVM VM
(Debian 12, kernel 6.1.0-53-cloud-arm64, JDK 21, MySQL 8.4, worker bundle built from this head).
Rounds 1–2 live one directory up (`pr12869/`, `pr12869/r2/`).

- `r3-0{1,2,3,4,5}-*.png`: evidence figures used in the PR comment.
- `assert.mjs` + `results/assert-r3.txt`: the 38 scripted checks against the saved raw logs (38/38 pass).
- `harness/host/`: host-side orchestration for this round (`run-r20.sh` reboot, `run-r21.sh` power cut
  with two controls, `run-r22.sh` crash injection, `run-r3-f1.sh` healthy traffic + Hosted chain,
  `r3-suites.sh` / `r3-real.sh` / `run-mut-r3.sh` Maven stages, `r3-gate-repro.sh` the flake re-check,
  `build-adapter.sh` the rig auth filter build).
- `harness/vm/s10-interrupt.mjs`: round-2 crash watcher plus one rig guard (skip `kill` while systemd
  reports `MainPID 0`; without it the watcher's second kill hit pid 0 — a rig bug, product untouched).
  Everything else in `vm/` is unchanged from the round-1/2 bundle.
- `harness/candidate/`: the F1 candidate diff re-applied to `8c2b626c` (applies cleanly, offset 58),
  `MaintenanceProbeWaiterTest` and `RebootRecoveryGapTest`.
- `results/`: raw VM-side outputs per run (`r20b-*`, `r21-*`, `r22b-*`, `r3-s6-*`, `r3-s7-*`),
  `mutation-r3.tsv`, and the per-stage console summaries quoted in the comment.

The VM ran the real server jar under systemd (`qwen-w0e3.service`) with MySQL 8.4 in docker;
power cut = SIGKILL on the qemu process, reboot = `systemctl reboot` inside the guest.
Tokens, passwords and keys in these files were generated for the rig and guard nothing.
