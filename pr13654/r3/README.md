# PR #13654 round 3: head `50312cfb`

Base is the merge base `2ebbd4e1`. Earlier rounds are in `../` (round 1, head `808759fa`) and `../r2/` (round 2, head `915ab691`).

## Files

- `01-csi-retirement.png`: store-level A/B for chiga0 F1 (CSI retirement), on real MySQL 8.4.7 and on H2.
- `02-stack.png`: covers three areas:
  - migration V63;
  - the contract re-run on the packaged stack;
  - paired latency.
- `candidate-settled-accepted-work.diff`: a +4/−2 candidate on `ToolPublicationDataStore.java`. It makes accepted seal/prefix/finish operations complete after a CSI retirement plus settle.

## Harness

- `harness/RigCsiRetirementProbe.methods.java`: the 11 probe methods.
- `harness/install.sh`: copies the PR's own `ToolPublicationAsyncVerificationTest` and `ToolPublicationAsyncVerificationMySqlIT`, renaming them `RigCsiRetirementProbeTest` and `RigCsiRetirementProbeMySqlIT`. It then inserts the probe methods, so the probes use the PR's own fixture and helpers.
- `harness/run.sh <head|revert|cand3>`: the A/B arms.
  - `revert` changes the one line from 58686a5d back to `Access.PRODUCE`.
  - `cand3` applies the candidate diff.
  - Both arms restore the source afterwards (blob hashes are printed).
- Real-stack scripts: `r4.sh` (contract matrix), `flyway-r4.sh` (migration upgrades), `lat-r4b.sh` + `paired2.sh` (paired latency). The other scripts are the same rig as round 2.

## Results

- `results/probe-{head,revert,cand3}.txt`: one line per probe and database.
- `results/run-*.txt`: the arm diff and a surefire/failsafe summary.
- `results/probe-reports/`: suite counts.
  - The first head run included `WorkspaceMigrationMySqlIT`. One `@Timeout(30)` case timed out at host load 88. The rerun at load 46 passed 6/6 (`head-WorkspaceMigrationMySqlIT-rerun.txt`).
  - `cand3-publication-family-h2.txt` covers 284 publication tests with the candidate applied.
- `results/flyway-r4.log`: covers G1, G2 and G3.
  - G1: a main-built schema at V62, then head.
  - G2: a fresh schema.
  - G3: a schema from the previous PR build at V61.
- `results/contract-r4.log`: the contract matrix on head. The `R3 [base]` entry is void because lane 2 was not started for that group.
- `results/paired-latency.log` and `results/pairs/`: pairs P45–P48, base and head started together.
  - `paired-latency-void-base-proxy-down.log` is a voided first attempt. The lane-2 proxy was down and the base arm got 503 at session create. Its head-only numbers match the valid run.
