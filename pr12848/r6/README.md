# PR #12848 real-stack verification, round 6

The head moved during the round: `a6dcb87b` → `018f3318` → `8b64220b` → `20126bae`.

- `results/a6dcb87b/`: runs on the review-fix commit (`*-r7`), the previous head's worker (`*-w6`, `6846d1e2`) for A/B, and the bundle-level mutant arm `m36` (N3 + N6 applied to `dist/`); `mutation-a6dcb87b.txt`.
- `results/018f3318/`: whole IT class and the Shell FG6b variant (`mvn -P hosted-workspace-tools`, MySQL 8.4.7, see `harness/run-it2.sh`, `harness/fg6b-shell-driver.diff`), rig probes (`*-r8`), real-model trials `s21-record-real-k/l`, keep-alive probe, SQL rows.
- `results/8b64220b/`: the same after the W0e merge (`*-r9`), plus the Workspace-hold probes (`s25`, `s28`), the worker-kill probe (`s27`, compare with `results/018f3318/s27-worker-kill-r8.log`) and the lease/binding rows.
- `results/20126bae/`: the head as pushed fails to start (duplicate Flyway V16 from main); IT and Shell FG6b with D4's migration renamed to V17 locally.
- `harness/`: probe scripts; `r6-01.txt` and `r6-02.txt` are the sources of the evidence cards.
