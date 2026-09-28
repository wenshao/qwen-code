# PR #12848 real-stack verification, round 6

- `results/018f3318/`: runs on the current head (bundle rebuilt at `018f3318`, Spring jar unchanged since `a6dcb87b` because Java production code is identical).
  - `it-HostedWorkspaceToolTurnIT-all.summary.txt`: the whole IT class, `mvn -P hosted-workspace-tools verify` against MySQL 8.4.7 (see `harness/run-it2.sh`).
  - `it-fg6b-shell-variant.summary.txt`: the FG6b test with the driver patched to issue a Shell call (`harness/fg6b-shell-driver.diff`); the Java assertions are unchanged.
  - `s*-r8.log`, `s21-record-real-k/l.log`: rig probes (fixture model and real qwen3.8-max).
- `results/a6dcb87b/`: runs on the review-fix commit (`*-r7`), the previous head's worker (`*-w6`, `6846d1e2`) for A/B, and the bundle-level mutant arm `m36` (N3 + N6 applied to `dist/`).
- `harness/`: probe scripts; `r6-01.txt` is the source of the evidence card.
