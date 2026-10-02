# PR #13138 — real-environment verification, round 3 (head `e50e2c37`)

Head `e50e2c37` = PR `0919b9d8` + main `3f56f74a` (#13129 Hosted Hooks H2, merged by the resolve bot as `85150b91`)
+ the W1b migration renamed to V28. Same Ubuntu 24.04 ext4 VM, MySQL 8.4.11 and rig as rounds 1–2.

| Path | What |
| --- | --- |
| `01-model-resources-blocker.png` | W1b refuses storages with post-upgrade model turns (head) vs the 3-line candidate |
| `02-flyway-fixed.png` | Duplicate V27 before `e50e2c37` (server start + Java tests) and after |
| `03-round2-holds.png` | Round-2 regression set on the merged tree + candidate; TS suites |
| `cand-r3-model-resource-kinds.patch` | Candidate: add `managed-hosted-model-route`/`-usage` to `RESOURCE_KINDS` + 1 test |
| `results/e2e-e50/` | Head artifacts: Hooks/MCP/plain storages (`m3-hooks*`), runbook with O2 (`runbook-head/`, `runbook-cand/`) |
| `results/e2e-m3/` | Merged tree before `e50e2c37`: same scenarios, round-2 matrix with the candidate (`r2-matrix-m3c.json`), cwd rule-out (`m3-cwd-*`), Flyway server logs |
| `results/*.txt, *.log` | Flyway matrices, Java targeted tests (`unit-java/`), TS unit logs |
| `harness/` | Scenario scripts, launcher, jar/test container scripts, card generator, this push script |

Builds: `e50` = `git archive e50e2c37` (sdk-java + core contracts) for the jars, `wt-e50` full
`pnpm install && npm run build && npm run bundle` for the CLI; `e50c` = the same plus the candidate patch.
The candidate bundle differs from the head bundle only in the W1b worker chunk (and its import in `cli.js`).
