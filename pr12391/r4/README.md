# PR #12391 — round 4 verification assets (head 4ddb2c3)

- `fig10` — gates on 4ddb2c3 and on 4ddb2c3 merged into main 0adae3c (Temurin 21.0.12 container; `logs/mvn-*.log`, `logs/module-gates.summary`), CI on the merge ref (`logs/ci-4ddb2c3.tsv`), and the guard-deletion sweep (`scripts/mutants4.py`, `logs/mutants4.log`): 11/11 new guards killed; the 6 items agreed for the tracking issue still survive.
- `fig11` — `scripts/PlanMatrixProbe4.java` (module package) on 25a38c3, on 25a38c3 + round-3 `arm-F2.patch` ("+rule"), and on 4ddb2c3 (`logs/matrix4-*.tsv`).
- `scripts/UnlistedTakeoverProbe.java` — after each move the doc does not list but the CAS accepts, the lease expires and a takeover yields UNKNOWN (`logs/unlisted-takeover.log`).
- Probes, mutants and T/F arms ran on Zulu 21.0.10.
