# Round 4: head fa7e06f78d (= main 48107945ea + H0c)

main holds two V16 migrations, so every local run moved D4's V16__managed_session_operation.sql to V17, as the PR author did. `results/main-as-is-startup.txt` shows main's jar failing without that move. The `results/ci-job-*-errors.txt` files list every error in this PR's two red CI jobs.

- `results/s13c-delete-handover-*.log`: the D4 delete handover race (writer B commits while the delete completes).
- `results/s15-write-after-tombstone.log`: a new writer commits after D4's tombstone. This is outside H0c.
- `results/v6-mutants.*`: 27 mutants, including J25 (W0e ABANDONED) and J26 (the DELETING guard).
- `results/java-verify-v6-first-run.summary.txt` has the two load flakes; `mysqlit-rerun.summary.txt` is the 13/13 rerun.
