# PR #12868, verification round 6 (head 5c0c9bf323)

Rounds 1 to 5 are one directory up (`../harness`, `../results`, `../r2` … `../r5`).
This directory holds what round 6 added or changed. The head is the round-5
head `42a059af96` plus one commit.

| Path | Content |
| --- | --- |
| `r6-0*.png` | the six figures of the round-6 report |
| `harness/s18-r6.mjs` | X1 where the cut lands, X2 Session ids, X2s every ASCII character in an id, X4 worker lost under a live Broker, X5 content modification at prepare, X6 large writes step by step |
| `harness/s19-restart.mjs` | the Broker process is replaced between two cancellations of a prepared call; then the caller acquires again, as the answer asks |
| `harness/s20-linux-restart.mjs` | the same on Linux, server and workers in a container, with `durable-local-process` on or off |
| `harness/linux/start.sh`, `harness/linux/fresh.sh` | how the server is started inside the container |
| `harness/fit-fuzz.mjs` | 3,000 random results for the built `fitManagedRuntimeProviderResult`, eight invariants |
| `harness/scenario-r6.sh`, `harness/regress-r6.sh` | one scenario on a fresh database and Broker; the probes of rounds 1 to 5 in one batch |
| `harness/proxy.mjs` | now keeps large answers of the worker in files beside the ledger, so a probe can compare them with what the caller received |
| `harness/lib.mjs` | `MYSQL_PORT` |
| `harness/mutants-r6.mjs` | the 40 round-6 mutants (K1 to K40), new anchors for five earlier mutants whose lines were rewritten, and the six that no longer have a line |
| `harness/mutants.mjs`, `harness/mutate.mjs`, `harness/mutation-flake-check2.mjs` | the earlier mutants and the runner; `TS_SET=provider` runs the eleven test files of the provider protocol and its worker |
| `harness/figures-r6.mjs`, `harness/facts-r6.mjs` | build the figures and the suite summary from the logs |
| `results/*.log` | probe logs; the name carries the build the probe ran on |
| `results/suites-head`, `results/suites-trial-merge` | summaries of the repository suites |
| `results/mutation` | the matrix, its summary and the load check |

Builds the logs name:

| Name in a log file | Build |
| --- | --- |
| `42a059af96` | the round-5 head |
| `5c0c9bf323` | this head |
| `merged-1b69629708-5c0c9bf323` | trial merge of this head with `main` `1b69629708` |

In the harness the same builds are the arms `h6`, `h7` and `tm7`.
Paths of the machine the rig ran on are replaced by `/rig-home` and `/opt/...`.

The Linux runs: Ubuntu 24.04 in a container (kernel 6.8, aarch64), JDK 21.0.9,
Node 22.23.2, MySQL 8.4 in a second container. The server jar and the worker
bundle are the ones built on macOS for the trial merge. The probe runs on the
host and reaches the Broker through a published port; there is no proxy between
Broker and worker in these runs.

Requests marked "sent by the rig" in the logs did not come from the Broker. They
go to the worker the Broker launched, with the Broker's own headers, to produce
an order of requests the Broker never sends.
