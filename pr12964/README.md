# PR 12964 verification evidence

- `01-semantic-conflict-12865.png` – main + PR fails `DurableLocalRuntimeFaultGateTest` (Linux); candidate `harness/candidate-durable-gate.diff`.
- `02-real-process-takeover-mysql.png` – rig-only probe `harness/G2ProbeFaultGateTest.java` on MySQL 8.4.11 with the durable local provisioner; raw ledger `results/g2probe2.jsonl`.
- `03-suites-mutation-flake.png` – suites, base A/B (M00), mutation (`harness/mutants.mjs`, `results/mutation-results.jsonl`), `awaitLeaseExpiry` flake and candidate `harness/candidate-lease-poll.diff`.
- `harness/rig-mysql-faultgaterig.diff` – rig-only switch that points the fault-gate harness at MySQL (`-Dgate.mysql.port`, container shares the DB's network namespace).
