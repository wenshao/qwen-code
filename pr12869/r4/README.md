# PR #12869 (W0e-3) real-host verification, round 4

Verified head: `62584d31` (= `55ded4c3` plus one renamed test class and two removed pom lines). Most runs were made on
`55ded4c3`; the server jars of `55ded4c3`, `62584d31` and of the merge with `main` `b1eb94da` have the same 537 class files
(`results/v5-build.console`, `results/v5m-jar.console`).
Rounds 1 to 3 are in the sibling directories; scripts that did not change are only there.

- `r4-0{1,2,3}-*.png`: evidence figures used in the PR comment. `harness/cards/` holds their source, `harness/render.mjs` renders them.
- `harness/host/`: host-side orchestration. `run-r9.sh` power cut with the two controls (R16), `run-r15.sh` hands-off reboot
  (R17, R20, R21), `run-r10.sh` reboot plus crash injection (R18, R19), `run-f1.sh` healthy traffic, the Hosted chain and the
  requests that must stay refused, `v4-run.sh` suites, `v5-build.sh` jar build and entry-by-entry comparison, `gap-run.sh`
  the wrong-host test against its mutants, `ci-*.sh` the two Java CI jobs replayed step by step.
- `harness/vm/`: scripts that changed or are new in this round (`s10-interrupt.mjs` crash watcher, `s11-unhealthy-waiters.mjs`).
- `harness/mut/`: mutants (`F01` to `F03` are new) and `run6.sh`, one sequential pipeline per mutant; a stage counts as a kill
  only if it fails twice in a row.
- `harness/candidate/`: `RebootRecoveryGapTest.java` (pins the wrong-host case), and the rename diff I used for the A/B before
  the author pushed the same change.
- `results/`: raw output of every run quoted in the comment.
  - `r16-*` power cut and controls, `r17-*` / `r20-*` / `r21-*` hands-off reboots, `r19-*` reboot with two crashes,
    `r18-first-attempt/` the earlier attempt whose second kill was misplaced.
  - `r16-lease-and-evidence.txt`: the bindings of R16 with and without a lease, and their evidence.
  - `r4-s6-*`, `r4-s7*`, `r4-s11-*`, `r4-f1-run.console`: healthy traffic, Hosted chain, refused requests.
  - `ci-jobs/`: replays at `55ded4c3` (`head/`), at the renamed tree that equals `62584d31` (`renamed/`), on the merge result
    (`merge/`), and the summaries taken from the real CI logs (`github-ci-62584d31/`).
    `ci-mariadb-rerun.console` documents a rig error: a replay on a database that an earlier run had used.
  - `mutation/`, `gap-test/`, `suites/`: mutation verdicts, the gap test against M01 and M16, per-suite summaries.

The Hosted job replay ran on macOS (JDK 21.0.12, Node 22.23.2, MySQL 8.4.7), the MariaDB job replay in a Linux container on
the dedicated host (MariaDB 10.11.18). GitHub CI runs both on Ubuntu.
Tokens, passwords and keys in these files were generated for the rig or come from the CI workflow and guard nothing.
