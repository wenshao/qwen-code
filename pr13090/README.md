# PR #13090 verification evidence (head d41914ff)

- `0*.png` — evidence cards used in the PR comment.
- `harness/rig/` — real-stack rig (Spring jar + packaged Hosted Harness + Broker worker, dedicated MySQL 8.4.7, TLS fake OSS, SQL tap).
  `sat.sh` (S1 held-candidate saturation), `s3.sh` (JVM freeze), `s3b.sh` (renew held at the SQL tap), `s4.sh` (grace change),
  `s5.sh` (legacy backlog; clones real rows in SQL), `arm-restore.sh` (identical snapshot per arm), `o4gate.sh` (runbook two-stage gate).
- `harness/realoss/` — temporary-bucket admin helper; credentials are read from a local file and never printed. `Ram.java` was
  attempted for a delete-denied identity and failed with NoPermission before creating anything.
- `harness/mut/` — Java/checker mutants and drivers; card generator.
- `results/reports/` — failsafe reports: O4 MySQL at head (run 2), O4 OSS at head (bucket name redacted), narrowed selector demo,
  O4 MySQL on the landing candidate.
- `results/logs/` — scenario logs and gate summaries. `results/landing-patches/` — the replay of O4-2 + O4-3 onto main d5c22d33
  (patch 0001 contains the one hand-resolved conflict; 0010 renames the collection migration to V31).
