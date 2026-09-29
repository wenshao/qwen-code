# PR #12868, verification round 7 (head ebea694e4e)

Rounds 1 to 6 are one directory up (`../harness`, `../results`, `../r2` … `../r6`).
This directory holds what round 7 added or changed. The head is the round-6
head `5c0c9bf323` plus seven commits:

| Commit | What it is |
| --- | --- |
| `e94f781523` | the answer to the round-4 review: released Sessions are retired |
| `a4849e2938` | the merge of `main` `12793013c4`, three conflicts resolved by hand |
| `174f974e3e` | one line of documentation |
| `50fb28301e` | main's input rules on the provider path |
| `9cb9dc86e8` | lost provider answers are reconciled over Broker HTTP; the directory of a Shell call is checked again before it runs |
| `760174073b` | the result fitter drops artifacts that cannot fit |
| `ebea694e4e` | the cancellation of a lost provider dispatch reaches its worker |

The branch moved five times while the round ran. Each state was built and
measured, and the logs of all of them are here.

| Path | Content |
| --- | --- |
| `r7-0*.png` | the seven figures of the round-7 report |
| `candidate-B.patch` | candidate B: a provider execution the worker still holds as prepared keeps its `409`; applies to the head |
| `harness/s21-r7.mjs` | Z1 what a released Session still answers, Z2 a live Session while others are retired, Z3 Sessions in parallel and the time of a release, Z4 the id rule at warm |
| `harness/s22-loss-in-flight.mjs` | the worker is killed while a Shell command runs; what the Broker and the Broker client answer afterwards; runs against the macOS rig or the Linux container |
| `harness/s23-merge-r7.mjs` | Y1 an unpaired surrogate in a deferred payload of the raw path, Y2 the same through the provider's `prepare`, Y3 a surrogate pair, Y4 a Shell call with a directory outside the workspace, Y5 a status cursor that is not written as an exact integer, Y6 the answer to execute is lost, Y7 a link moved out of the workspace after prepare, Y8 a start the worker refuses |
| `harness/fit-artifacts.mjs`, `harness/fit-fuzz.mjs` | the result fitter as built, with artifacts, and the fuzz of round 6 |
| `harness/s3-retention.mjs`, `harness/s3b-retention-raw.mjs`, `harness/release-latency.mjs` | worker memory over released Sessions, provider path and raw path; the time of a release from the proxy's ledger |
| `harness/s1-contract.mjs`, `harness/s2-faults.mjs`, `harness/s11-error-envelope.mjs` | probes of rounds 1 and 2; F.1, F.2 and S.exec state the rule of `9cb9dc86e8` |
| `harness/s20-linux-restart.mjs`, `harness/linux/` | the Broker restart on Linux with the durable provisioner, as in round 6 |
| `harness/regress-r7.sh`, `harness/batch-r7b*.sh`, `harness/scenario-r6.sh`, `harness/kill-scenario.sh` | the probes of rounds 1 to 6 in one batch; the round-7 probes, memory runs and scenarios; one scenario on a fresh database and Broker |
| `harness/gate-repeat.sh`, `harness/gate-facts.mjs`, `harness/fault-gate-profile.mjs` | one fault-gate class repeated on one build, and the summaries of those runs |
| `harness/mutants-r7.mjs` | the 35 mutants of `e94f781523` (L1 to L35), new anchors for seven earlier mutants whose lines were rewritten, and the one that no longer has a line |
| `harness/mutants-r7b.mjs` … `harness/mutants-r7f.mjs` | the mutants of the merge (M1 to M3), of `50fb28301e` (P1 to P9), of `9cb9dc86e8` (Q1 to Q6), of `760174073b` (R1, R2) and of `ebea694e4e` (S1, S2), with the new anchors each commit made necessary |
| `harness/mutants-r6.mjs`, `harness/mutants.mjs`, `harness/mutate.mjs`, `harness/anchors-check.mjs` | the earlier mutants, the runner, and a dry check of every anchor |
| `harness/cand11-apply.mjs` | writes candidate B into a worktree |
| `harness/figures-r7.mjs`, `harness/facts-r7.mjs`, `harness/facts-head-r7b.mjs`, `harness/ci-facts.mjs` | build the figures, the suite summary and the facts about the head from the logs, from git and from GitHub |
| `harness/lib.mjs`, `harness/proxy.mjs` | the rig library and the proxy; `ATTEMPT_LIMIT_MS` in the library bounds how long a probe waits for one answer |
| `results/*.log` | probe logs; the name carries the build the probe ran on |
| `results/remerge-a4849e2938.diff` | `git show --remerge-diff` of the merge commit: what was written by hand |
| `results/suites-head`, `results/suites-trial-merge` | summaries of the repository suites |
| `results/fault-gate-runs` | result lines of every repeated run of `DurableLocalRuntimeFaultGateTest` |
| `results/mutation` | the matrix on the head and its summary; `results/mutation-e94f781523` is the matrix of the first commit |

Builds the logs name:

| Name in a log file | Build |
| --- | --- |
| `5c0c9bf323` | the round-6 head |
| `e94f781523` | the first commit of this round, before `main` was merged |
| `174f974e3e` | the merge of `main` and the documentation commit |
| `50fb28301e`, `9cb9dc86e8`, `760174073b` | the later states of the branch, each the head for a while |
| `ebea694e4e` | this head |
| `merged-be1ebc74d7-ebea694e4e` | trial merge of this head with `main` `be1ebc74d7` |
| `ebea694e4e-candidate-B` | this head with candidate B in the Broker; worker and provider client are the head's |
| `main-12793013c4` | `main` as the head holds it, without this PR |
| `merged-…` and `main-4fddf47ee3` | trial merges with, and the `main` of, the hour an earlier state was measured |

In the harness the same builds are the arms `h7`, `h8`, `h9`, `h10`, `h11`,
`h12`, `h13`, `tm13`, `cand13`, `m9`, and `tm8`, `tm10`, `tm11`, `tm12`, `m8`.
Paths of the machine the rig ran on are replaced by `/rig-home` and `/opt/...`.

The Linux runs: Ubuntu 24.04 in a container (kernel 6.8, aarch64), JDK 21.0.9,
Node 22.23.2, MySQL 8.4 in a second container. The server jar and the worker
bundle are the ones built on macOS for the build the log names. The probe runs
on the host and reaches the Broker through a published port; there is no proxy
between Broker and worker in these runs.

Requests marked "sent by the rig" in the logs did not come from the Broker. They
go to the worker the Broker launched, with the Broker's own headers, to produce
an order of requests the Broker never sends. In Y5 the proxy rewrites one answer
of the worker, in Y6 it drops one; the log marks both.

The host was under load from other work during this round (load average 13 to
54 on ten cores). The repeated fault-gate runs record the load of each run.
Scenarios that kill a worker find it by the path of its build; they were run
one at a time, with no other stack of the same build alive.
