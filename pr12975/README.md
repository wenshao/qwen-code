# PR #12975 real-environment verification (head a2658844)

- `01-hosted-surrogate-ab.png`, `02-broker-api-and-install.png`, `03-tests-faults-mutations.png`: figures in the PR comment.
- `logs/hosted-*.log`: Hosted real-stack probe (Spring + MySQL 8.4 + packaged Harness + real Worker), per arm; `hosted-pr-plus-client-candidate.log` uses the Harness built with `rig/cand-client-refusal.diff`.
- `logs/broker-to-worker-*.jsonl`: Broker -> Worker requests captured by `rig/wire-tap.mjs` (JVM `-Dhttp.proxyHost`, empty `-Dhttp.nonProxyHosts`). Publisher tokens redacted.
- `logs/broker-api-*.log`: direct Broker HTTP API probe (`rig/s3-direct.mjs`).
- `logs/install-*.jsonl`, `logs/deadline-race-trials.log`: `rig/Rig12975.java` (install matrix, MySQL-trigger faults on the RECOVERY_BLOCKED write).
- `logs/mysql-it-twice.log`, `logs/*fault-gate*.log`, `results/mutations.jsonl`: A/B and sweep summaries.
- Arms: main = origin/main 1b69629; PR = main + a2658844 (local merge ddb2fa3c); tests A/B on merge-base 99adce25.
