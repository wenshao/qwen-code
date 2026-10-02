# PR #13138 — real-environment verification, round 4 (head `d8bc703e`)

Head `d8bc703e` (B1 fix `258c57ed`, W1b migration V31, retired-Session evidence) and the same head merged with
main `d5c22d33` (#13144 undo receipts, #12965 Flyway guard). Same Ubuntu 24.04 ext4 VM + MySQL 8.4.11 rig.

| Path | What |
| --- | --- |
| `01-b1-fixed.png` | Storages on round-3 head vs `d8bc703e` vs `d8bc703e` + main; Flyway arms |
| `02-retirement.png` | Two Sessions deleted through the real Java completion; six single-deviation tampers |
| `results/e2e-r4/` | `m3-hooks*` (Hooks/MCP/plain), `r4-runbook-{d8b,m4}*` (runbook + undo + deletions + R1-30 + tampers), Flyway server logs, every maintenance run's stdout/stderr |
| `results/*.txt, *.log` | Flyway matrix, W1b unit suites on head and head + main |
| `harness/` | `r4-runbook.mjs`, `r4-flyway.sh`, card generator, push script |

Builds: jars from `git archive` (sdk-java + core contracts) in a Maven / JDK 21 container; bundles from full
`pnpm install && npm run build && npm run bundle` of `d8bc703e` and of the merge `03fd95af` (d8bc703e + d5c22d33).
The W1b worker chunk is byte-identical in both bundles (`workspace-recovery-worker-652HQW3H.js`).
