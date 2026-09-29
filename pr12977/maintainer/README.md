# Maintainer physical verification evidence (second machine)

Screenshots from an independent physical verification on Linux aarch64
(CIX P1 CD8160, Temurin JDK 21, MySQL 8.4.11 in Docker, Node 24 bundle):

- `pr12977-fault-gates.png` — Runtime Broker fault-gate suite on the PR head
  vs the pre-PR baseline, reproducing the CI failure of "Hosted process fault
  gates / MySQL 8.4 / Java 21" locally.
- `pr12977-h2-root-cause.png` — bisect and instrumentation showing the
  H2 2.3.232 MVStore storage bug triggered by the new
  `managed_workspace_operator_recovery` DDL in `runtime-broker/schema.sql`.
- `pr12977-physical-verification.png` — end-to-end physical operator-recovery
  run: real MySQL 8.4, real durable local worker, real detached escaped Shell
  writer, and the shipped operator-recovery jar driving inspect → prepare →
  fence checks → refusal negatives → complete → reuse (34/34 steps).
- `pr12977-audit-trail.png` — persisted audit row and generation state after
  the completed run.
