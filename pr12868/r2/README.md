# PR #12868, verification round 2 (head f0f217dfa5)

Round 1 is one directory up (`../harness`, `../results`). This directory holds
what round 2 added or changed.

| Path | Content |
| --- | --- |
| `r2-0*.png` | the five figures of the round-2 report |
| `candidate-bounded-reason.patch` | candidate for R1, relative to `f0f217dfa5`: bounds the reason in the worker, with a test |
| `harness/s11-error-envelope.mjs` | groups P (three hops), Q (recovery in the same Session), R (reason bound), S (tampered answers) |
| `harness/s12-lost-control.mjs` | groups K (lost control replies), L (enumeration agreement) |
| `harness/proxy.mjs` | the rig proxy, now with a `rewrite` fault |
| `harness/mutants.mjs` | the 40 round-1 mutants and the 21 round-2 mutants (`round2`) |
| `results/s11-error-envelope-r1-PR.log` | previous head `f67bde6b41` |
| `results/s11-error-envelope-pr-PQRS.log` | this head |
| `results/s11-error-envelope-cand-PRS.log` | this head plus the candidate |
| `results/suites-head`, `results/suites-merged` | summaries of the repository suites on this head and on the trial merge with `main` `c767078ff7` |
| `results/upgrade` | this head started on the database the previous head had written |
| `results/mutation` | the matrix and its summary |

Arms: `wt-r1` = `f67bde6b41`, `wt-pr` = `f0f217dfa5`, `wt-cand` = `f0f217dfa5` +
candidate (TypeScript only, Java jar of `wt-pr`), `wt-mg` = `main` + `f0f217dfa5`.
