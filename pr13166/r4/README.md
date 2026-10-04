# PR #13166 real-stack verification, round 4 (head 6b86c46c)

Same rig as earlier rounds. Main was merged into the PR (Java and lockfile changed): dependencies reinstalled from
the lockfile, server jar + rig adapter rebuilt (`server/head4-server.jar`, migrations to V34), Harness and Runtime
worker rebuilt (`dist/head4`). #13211 made two Linux-only Broker defaults true; on this macOS host Spring runs with
`--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false`
(`SPRING_EXTRA` in `probe/spring.sh`). Host load was 110-220 during the run (other sessions), so absolute timings are high.

| DB | Runtime worker | Scenarios |
| --- | --- | --- |
| g12b | head4 | regression `run-r3.sh` (S1-S6, S9), S19 gate edges / R6-1 / R4-10 / wildcard and extglob shapes (each wedge in its own Workspace), S20 R4-7 recovered truncation |
| g13 | cand4 | S19 on the candidate (Harness + worker), and a 6b86c46c Harness with the candidate worker |

- `candidate-matcher-cost.patch` — refuse extglob groups and more than 3 `*` per path segment in `checkHostedGlobPattern` (+47/-2).
- `matcher-calibration.txt` — local minimatch/glob timings behind the limit (`probe/redos*.{cjs,mjs}`).
