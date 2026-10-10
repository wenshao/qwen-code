# PR #13654 round 2 (head 915ab691, base 1f4484d3)

- `01-round2.png`, `02-latency.png`: cards. `candidate-poll-backoff.diff` (25 ms first poll, x2 up to 250 ms) and
  `candidate-async-scans-only.diff` (async header only for seal / prefix / finish), both against 915ab691.
- `results/r3.log`: functional matrix (R1-R13 on lanes 1/2; R31-R32 flag off; R41-R42 legacy worker).
- `results/paired-r3.log`: paired latency. P51-P57 head vs base, P21-P27 candidate 2 vs base, P31-P37 candidate 1 vs base.
  P61-P77 are void (rig mounts only storages s01-s60; both lanes failed identically) and were re-run as P21-P37.
- `results/flyway-r2.log`: real MySQL checks on dc9e6abf + main 1f4484d3 (V57 duplicate; V58 rejected on a V60 DB; V61 applies).
  `results/flyway-r3.log`: head 915ab691 against main 6386bb24 (guard) and a main-built V60 DB (applies V61).
- `harness/`: round-2 additions on top of `../harness` (lanes via `up-l.sh`/`spring-l.sh`, `r2run.sh`, `r3.sh`,
  `paired2.sh`, fake OSS GET `403` fault, `HOLD_ACTION=lapse` in `s654.ts`).
