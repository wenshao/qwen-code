# PR #12868, verification round 3 (head ac0b6cf966)

Rounds 1 and 2 are one directory up (`../harness`, `../results`, `../r2`). This
directory holds what round 3 added or changed. The head is the merge of the
round-2 head `f0f217dfa5` with `main` `d66fdadd27` (#12839 on top).

| Path | Content |
| --- | --- |
| `r3-0*.png` | the seven figures of the round-3 report |
| `remerge-r3.diff` | `git show --remerge-diff ac0b6cf966`: what the recorded merge changes against a mechanical one |
| `harness/s13-merge.mjs` | M1 receipts after release, M2 repeated cancellation of a prepared call, M3 worker death (provider and raw path), M4 repeated cancellation of a dispatched call, M5 a cancellation that loses the race |
| `harness/kill-scenario.sh` | one worker-death scenario on a fresh database and Broker |
| `harness/s14-details-envelope.mjs` | the built client against a stand-in peer: three-key and four-key error envelopes |
| `harness/mutants.mjs` | the 40 round-1 mutants, the 21 round-2 mutants (`round2`) and the 9 round-3 mutants (`round3`, G1–G9) |
| `harness/figures-r3.mjs` | builds the figures from the logs and from git |
| `results/s13-merge-prev-*.log` | previous head `f0f217dfa5` |
| `results/s13-merge-main-*.log` | `main` `d66fdadd27`, raw path |
| `results/s13-merge-pr-*.log` | this head |
| `results/s13-merge-g4mutant-*.log` | this head with mutant G4 compiled into the server jar |
| `results/*-mg2-*.log` | trial merge of `main` `fc4e01b9fc` + #12900 + this head |
| `results/v16-collision.log` | the two V16 migrations on `main`: trees, CI, trial merges |
| `results/suites-head` | summaries of the repository suites on this head |
| `results/suites-merged-main` | the same on `main` `6300ad997c` + this head (server and Hosted suites cannot start) |
| `results/suites-merged-main-12900` | the same on `main` `fc4e01b9fc` + #12900 + this head |
| `results/mutation` | the matrix and its summary |

Arms: `wt-r2` = `f0f217dfa5`, `wt-main` = `d66fdadd27`, `wt-pr` = `ac0b6cf966`,
`wt-g4` = `ac0b6cf966` with mutant G4 (Java only, worker of `wt-pr`),
`wt-mg` = `main` `6300ad997c` + head, `wt-mg2` = `main` `fc4e01b9fc` + #12900 + head.

A worker death makes the Broker refuse later placements of the tenant, so every
worker-death scenario runs on its own database and Broker.
