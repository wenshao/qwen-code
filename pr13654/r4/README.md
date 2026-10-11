# PR #13654 round 4: head `569befb8`

Base is the merge base `6936c77e`. Earlier rounds are in `../` (round 1), `../r2/` and `../r3/`.

## Files

- `01-fix-commits.png`: store-level A/B for the three fix commits since round 3 (`99ff6152`, `f4eee7cb`, `569befb8`), on real MySQL 8.4.7 and on H2.
- `02-stack.png`: covers four areas:
  - the round-3 CSI probes re-run;
  - migration V68;
  - the async contract and R6-1 on the packaged stack;
  - paired latency.
- `candidate-settled-accepted-work.diff`: the round-3 candidate. It still applies to `569befb8` unchanged.

## Harness

- `harness/RigR4Probe.csi-methods.java`: the 11 round-3 probes (A–I).
- `harness/RigR4Probe.r4-methods.java`: the round-4 probes:
  - J, K, L: a failed object terminal, a failed DELETE, then a later finish;
  - M: a failing failure handler with two queued candidates;
  - N: the publication grant expires on its own, then is renewed.
- `harness/install.sh`: copies the PR's own `ToolPublicationAsyncVerificationTest` and `ToolPublicationAsyncVerificationMySqlIT`, renaming them `RigR4ProbeTest` and `RigR4ProbeMySqlIT`. It then inserts the probe methods and gives the bucket double an injectable `DELETE` failure.
- `harness/run.sh <r3|99ff|f4ee|head|cand3>`: the A/B arms.
  - `r3`, `99ff` and `f4ee` replace only `ToolPublicationStore.java` and `ToolPublicationDataStore.java`, with the versions from `50312cfb`, `99ff6152` and `f4eee7cb`.
  - `cand3` applies the candidate diff.
  - Every arm restores the source afterwards and prints the blob hashes.
- `harness/run-mn.sh`: re-runs M and N only. The first head and cand3 runs hit a timestamp cast in the probe helper on MySQL (`LocalDateTime` to `Date`). The helper was fixed before the `f4ee` arm.
- `harness/all.sh`: runs the arms in sequence. `harness/matrix.py` builds `results/probe-matrix.txt`.
- Packaged-stack scripts:
  - `r5.sh`: groups `F1` (contract matrix) and `A1` (R6-1).
  - `flyway-r5.sh`: migration upgrades.
  - `lat-r5.sh` + `paired2.sh`: paired latency.
  - `termcheck.py`: the terminal rows in MySQL and the terminal key in the OSS double.
- `fake-oss.mjs` now implements `DELETE` (204, or an injected 403/500). Earlier rounds answered `DELETE` with 400.

## Results

- `results/probe-matrix.txt`: one short outcome per probe and arm. It flags any H2/MySQL disagreement; there are none.
- `results/probe-<arm>.txt`: the raw probe lines. `results/run-<arm>.txt` and `results/probe-reports/` hold the suite counts.
  - The PR's MySQL suite ran on `head` (52/52) and `cand3`.
  - On `cand3`, `acceptanceWaitsForTheReadyTransactionToCommit` failed once at its 5 s latch under load. See `results/one-test-reruns.txt`.
- `results/flyway.log`: covers G1, G2 and G3.
  - G1: a `main`-built schema at V67, then head.
  - G2: a fresh schema.
  - G3: a schema from the round-3 build at V63, then head.
- `results/contract-and-r6-1.log`: R1–R7 are the contract matrix on head.
  - R8 is R6-1 on head.
  - R9 is the same scenario on the round-3 jar (`JAR_ARM=head4` = `50312cfb`). Its label says `[head]` because the lane is the head lane.
- `results/r6-1-terminal-check.txt`: the terminal state after R8 and R9.
- `results/paired-latency.log`: pairs P51–P52, base and head started together.
