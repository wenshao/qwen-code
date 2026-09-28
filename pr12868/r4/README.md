# PR #12868, verification round 4 (head cc06ee0e4e)

Rounds 1 to 3 are one directory up (`../harness`, `../results`, `../r2`, `../r3`).
This directory holds what round 4 added or changed. The head is the round-3
head `ac0b6cf966` plus one TypeScript commit.

| Path | Content |
| --- | --- |
| `r4-0*.png` | the six figures of the round-4 report |
| `candidate-unknown-confirms-cancel.patch` | candidate for what remains of R1-32, relative to `cc06ee0e4e`: the Broker accepts `unknown` when it confirms the cancellation of a prepared call, with a test |
| `harness/s15-fix.mjs` | U1 refused acquire then the raw path, U1b refused acquires then the provider path, U2 repeated cancellation of a forgotten call through the Broker, U3 status / cancel / execute for a forgotten reference, U4 progress cursor |
| `harness/proxy.mjs` | the rig proxy, now with `/__rig/send`: one request to a worker with the headers the Broker last used for it |
| `harness/lib.mjs` | `inject()` and `workerPortOf()` |
| `harness/mutants.mjs` | adds the 11 round-4 mutants (`round4`, H1 to H11) |
| `harness/figures-r4.mjs` | builds the figures from the logs and from git |
| `results/s15-fix-r3-*.log` | previous head `ac0b6cf966` |
| `results/s15-fix-pr-*.log` | this head |
| `results/s15-fix-cand-U2.log` | this head plus the candidate (Java jar of the candidate, worker of this head) |
| `results/*-mg2-*.log` | trial merge of this head with `main` `b32f261afd` |
| `results/head-facts.log` | the commit, and the CRC comparison of the classes in the two server jars |
| `results/acquire-census.log` | every `acquire` on the wire in this round: sent by the Broker or by the rig, and how it was answered |
| `results/fault-gate-flake-*.log` | `ProcessCrashFaultGateTest` on `main`'s Java and on this PR's Java |
| `results/ts-serve-attribution.log` | the cli `src/serve` run and the files rerun alone on both heads |
| `results/suites-head`, `results/suites-merged-main-*` | summaries of the repository suites on this head and on the trial merges with `main` `6017f11dfb` and, after `main` moved, `b32f261afd` |
| `results/mutation` | the matrix and its summary |

Arms: `wt-r3` = `ac0b6cf966`, `wt-pr` = `cc06ee0e4e`, `wt-cand` = `cc06ee0e4e` +
candidate (Java only, worker of `wt-pr`), `wt-mg` = `main` `6017f11dfb` + `cc06ee0e4e`, `wt-mg2` = `main` `b32f261afd` + `cc06ee0e4e`,
`wt-main` = `d66fdadd27` (fault gate comparison only).

Requests marked "sent by the rig" in the logs did not come from the Broker. They
go to the worker the Broker launched, with the Broker's own headers, to produce
an order of requests the Broker never sends.
