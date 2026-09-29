# PR #13032 verification rig (2026-09-30)

These are rig-only probes for PR #13032. None of them are proposed for the PR, apart from `r1-1-pair.patch`, which is the review's suggested R1-1 pair plus the missing `anyInt` import.

## Arms

| Arm | Commit |
|---|---|
| base (the PR's merge-base) | `8c914ebe03` |
| PR head | `61069e6287` |
| trial merge onto main `b906f937ec` | a `merge-tree` commit |

## Harness

| File | What it does |
|---|---|
| `harness/install-deps.sh` | Installs `qwencode` and `runtime-broker` from one arm into that arm's own Maven repository. |
| `harness/run-class.sh` | Runs `mvn -o` inside `packages/sdk-java/managed-agent-server`, using JDK 21.0.12. |
| `harness/p1-widen.mjs` | Applied identically to base and PR. After each insert→claim gap in the six tests, and after `releaseTurnLease` in `transfersHarness…`, it waits up to 500 ms. It prints whether the recovery scanner claimed the Turn. |
| `harness/p2-natural.mjs` + `p2-toggle-fix.mjs` | Add a probe test that loops `insertSessionCommand → insertTurnCommand → claimTurn` in three modes (listed below). They also add counters to `HarnessCoordinator.recoverExpiredTurns`. |
| `harness/in-container.sh` | Used in the Linux runs: `docker run --cpus 2 -v <rig>:/rig maven:3.9.11-eclipse-temurin-21` on a 2-vCPU colima VM. |
| `harness/mutants.mjs` | **M1:** drop the `@AfterEach`. **M4:** delete the availability gate in `recoverExpiredTurns`. |
| `harness/r1-1-pair.mjs` | Adds the review's suggested pair. **M5** (gate always returns) was a one-line in-place edit. |
| `harness/txn-alt.mjs` | The triage's transactional alternative for `transfersHarness…`. It is applied to base on top of `p1-widen`. |
| `harness/mine.sh` | Takes the last 400 `sdk-java.yml` runs and pulls the `--log-failed` output of every failed run. |

### Probe loop modes (`p2-natural.mjs`)

| Mode | Scanner state |
|---|---|
| U | Scanner live |
| P | Paused for the whole loop |
| T | Each iteration: available=true, then a random sleep of 0–59 ms, then pause, insert, claim. This mode ran 20,000 iterations on Linux and 2,000 on macOS. |

## Results

Results are in `results/`. The figures are `01-*.png` to `03-*.png`.
