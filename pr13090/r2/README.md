# PR #13090 round 2 (head 083a7efc; code identical to 02eaf790)

- `r2-01-gates.png`, `r2-02-status.png` — cards used in the round-2 comment.
- `results/reports/o4-mysql` — local `-Po4-mysql-gates` failsafe report (macOS, MySQL 8.4.7), 40/40.
- `results/reports/o4-oss` — local `-Po4-oss-gates` on real Aliyun OSS (bucket name redacted), 41/42; the delete-denied case
  ran with the same identity because no second identity could be created.
- `results/reports/ci-o4` — the `o4-mysql-gate-reports` artifact of SDK Java run 37087455054 (Linux amd64, Temurin 21), 40/40.
- `results/logs` — gate summaries and the O4 step summary extracted from the CI job log.
- `results/results-k1.json`, `harness/run-k1.mjs` — K1 mutant (`buildOss` ignores its credentials argument).
