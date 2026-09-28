# PR #12868, verification round 5 (head 42a059af96)

Rounds 1 to 4 are one directory up (`../harness`, `../results`, `../r2`, `../r3`, `../r4`).
This directory holds what round 5 added or changed. The head is the round-4
head `cc06ee0e4e` plus five commits and a merge of `main` `cd0b35c153`.

| Path | Content |
| --- | --- |
| `r5-0*.png` | the seven figures of the round-5 report |
| `candidate-broker-refuses-unsafe-ids.patch` | relative to `42a059af96`: the Broker refuses at acquire the Session ids the worker would refuse at release, with a test |
| `candidate-receipt-after-restart.patch` | relative to `42a059af96`: a terminal cancellation receipt is answered when this Broker process holds no live Session for the id, with a test |
| `remerge-42a059af96.diff` | `git show --remerge-diff 42a059af96`: what the recorded merge changes against a mechanical one |
| `harness/s16-r5.mjs` | W1 large results, W1d where the cut lands, W2 status / cancel / heavy progress, W3 Session ids, W4 receipt while `RELEASING`, W6 re-labelled refusals |
| `harness/s17-restart.mjs` | W5: the Broker process is stopped and started again between two cancellations of the same prepared call |
| `harness/s15-fix.mjs` | the round-4 probes, rerun |
| `harness/lib.mjs`, `harness/proxy.mjs` | the rig library and the proxy between Broker and worker |
| `harness/spring.sh`, `harness/restart-spring.sh`, `harness/kill-scenario.sh` | how a Broker, its proxy and a fresh database are started |
| `harness/build-arm.sh`, `harness/java-build.sh` | builds; `clean package` on the server module, because `package` alone kept the fat jar of the previous head |
| `harness/mutants.mjs`, `harness/mutate.mjs`, `harness/mutation-flake-check2.mjs` | the 109 mutants (28 new: `round5`, I1 to I28), the runner, and the check that tells a kill from a load failure |
| `harness/figures-r5.mjs` | builds the figures from the logs and from git |
| `harness/suites.sh` | the repository suites on MySQL |
| `results/*.log` | probe logs; the name carries the commit the probe ran on |
| `results/candidates` | each candidate's test without and with its production change; Broker unit suite, Checkstyle and the fault gates with both candidates |
| `results/suites-head` | summaries of the repository suites on this head |
| `results/mutation` | the matrix, its summary and the load check |

Builds the logs name:

| Name in a log file | Build |
| --- | --- |
| `cc06ee0e4e` | the round-4 head |
| `fe7895d330` | the head as it was when Session ids had to be lowercase UUIDs |
| `42a059af96` | this head |
| `42a059af96-candidates` | this head plus both candidates (server jar of the candidates, worker and provider client of this head) |
| `main-cd0b35c153` | the `main` commit this head merges |
| `merged-bd45b95f82-fe7895d330` | trial merge of `fe7895d330` with `main` `bd45b95f82`, made before the author merged |

In the harness the same builds are the arms `r4`, `pr`, `h6`, `cand`, `m6` and `mg`.
Paths of the machine the rig ran on are replaced by `/rig-home` and `/opt/...`.

Requests marked "sent by the rig" in the logs did not come from the Broker. They
go to the worker the Broker launched, with the Broker's own headers, to produce
an order of requests the Broker never sends.
