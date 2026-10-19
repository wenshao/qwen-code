# PR 14733 local verification evidence

- Head: `413751ace1627c2d06dbc9540d77fff34502c292`
- Round: r1, 2026-10-19 (Beijing)
- Environment: macOS host + colima Ubuntu 24.04 container (2 vCPU / 3.8 GB), Temurin 21, Maven 3.9.11, Node 22.23.3, runner-private MySQL 8.0.46 (Ubuntu package, same flavour the `hosted-failover-e2e` job installs), real head CLI bundle and real head server jar.

## Files

| File | Content |
| --- | --- |
| `01-head-arm-green.png` | `npm run test:e2e:managed-harness-restart-approval-after-result` passes at head |
| `02-mut-reissue-red.png` | Product mutant M1 (reissued request rewritten) is killed by the deep-equal assertion |
| `03-mut-retract-red.png` | Product mutant M2 (`retractOriginal` no-op) is killed by the transcript assertion |
| `04-static-gates.png` | Four script suites (254 tests), workflow size ratchet, typecheck, ESLint |
| `05-durable-evidence.png` | `approval-crash-barrier.json` and `summary.json` written by the green run |
