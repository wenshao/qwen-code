# PR #12977 verification evidence (head aeaf0ade85)

- `01`–`04-*.png`: figures used in the PR comment.
- `cand-capture.patch`: candidate fix for F1 (capture() accepts protocol-3 deferred Shell references) + a WorkspaceRuntimeTest case using the production reference shape.
- `harness/vm/`: scripts run inside the Linux VM (S0/S1 `s1-operator-flow.mjs`, S3 `s3-crash-retry.mjs`, S4 `s4-reboot.mjs` + `s4-watch.sh`, S5 `s5-lost-first.mjs`, S6 `s6-base.mjs`, S7 `s7-identity.mjs`, root cause `diag-toolname.mjs`).
- `harness/container/`: CI job replay and build scripts (Maven 3.9.11 + Temurin 21 container).
- `harness/mut/`: mutant definitions and runner.
- `results/e2e/`: scenario logs; `maintenance-output/` holds the maintenance command's full stdout/stderr per call.
- `results/ci-replay/`, `results/unit-ab/`, `results/mutation/`, `results/flyway/`: summaries.
