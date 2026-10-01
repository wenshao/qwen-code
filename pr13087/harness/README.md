# PR #13087 verification rig

Real stack on macOS 26.6 arm64: MySQL 8.4.7 (local mysqld), the Spring server jar built from the PR head
(Session Store + embedded Runtime Broker + local-process workers), the packaged Hosted Harness
(`dist/cli.js serve --profile hosted-harness`) and a real Shell tool driven by a fake OpenAI-compatible model.
Each Shell call is one O2 publication written through the production publication ingress.

| File | Role |
| --- | --- |
| `spring.sh`, `up.sh` | start one Spring instance (`GC`, `GRACE`, `LOCKWAIT`, `DBPORT`, `HOSTS_FILE=none` for real OSS) |
| `mk.ts`, `mk.sh` | create a Workspace Session, run N real Shell calls (`RUNS=so:se:code,...`), detach |
| `retire.sh` | **seam**: writes the DELETE operation row + `DELETING` status that `ManagedAgentStore.beginOperation` writes, because the public and WebShell DELETE refuse Workspace Sessions (`409 workspace_unavailable`). The production `SessionLifecycleCoordinator` then claims it and runs `completeOperation -> lockDeletion -> retire`. |
| `watch.mjs`, `snap.sh` | sample `retention_state`, claim generation, cursor, held/used bytes and objects left under the publication prefix |
| `fake-oss.mjs` | TLS Aliyun OSS double (now with `DeleteObject`, delete faults `drop-reply`/`403`/`500`/`delay`/`hold`, `/put` decoys) |
| `sqltap.mjs`, `taplog.mjs` | MySQL relay that logs each statement with its OK/affected-rows; SIGUSR2 stalls the next matching statement (used to hold a stale owner's confirmation) |
| `sat.sh` | blocked-candidate saturation run (E at t0, 150 publications at t0+60 s, grace 120 s) |
| `mut.mjs` | mutation matrix (one mutant at a time in a separate worktree; `MUT_RUN=1`) |
| `RealOss.java` | real-OSS admin helper (temporary private bucket; credentials read from a local file, never printed) |
| `candidate-claim-scheduling.patch` | grace blocker -> `gc_next_at = retired_at + grace`; up to 32 candidates per tick |
| `candidate-test-resource-scope.patch` | test that kills M12 (resource cleanup widened) and M13 (used bytes not zeroed) |
| `cards.json` | source text of the evidence images |

Connector/J sends query attributes, so COM_QUERY text starts with `\u0000\u0001`; strip it before matching.
