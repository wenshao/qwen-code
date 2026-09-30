# PR #13088 — real-environment verification, round 2 (head c21efbdfa1)

Evidence for the round-2 report on https://github.com/QwenLM/qwen-code/pull/13088. Round 1 is one directory up.

| Path | Content |
| --- | --- |
| `r2-0*.png` | The evidence cards embedded in the report. They are rendered from `harness/fig/cards-r2*.mjs`; every value comes from the logs under `results/`. |
| `trial-merge-resolution.diff.txt` | The hand-made part of the local trial merge with main `78143fe335`: the connector conflict, the `resolveAction` call, the one test, the V25 rename. |
| `results/head-c21efbdfa1/` | Console output and scenario logs for the PR head as pushed (base arm = main `3a8fd11711`). |
| `results/head-c21efbdfa1-mariadb/` | Identity matrix and restore-from-backup on MariaDB 10.11.18. |
| `results/trial-merge/` | The same scenarios on the trial merge, its unit tests and the two W1a ITs. |
| `results/mutation/` | Java unit-stage and IT-stage mutation, TypeScript mutation (idle Linux host). |
| `results/ci/` | Test totals and W1 markers extracted from GitHub job 109918078098. |
| `harness/vm/` | Scenario scripts run inside the Linux VM (`s13` birth time, `s14`/`s14b`/`s16` O2 publication, `s15` Hosted MCP, `s5b` storage layout, `s4` reboot, the round-1 scripts as used this round). |
| `harness/vm/o2/` | The OSS double and the stdio MCP server. The TLS key pair for the OSS double is not published; generate a private CA and a leaf certificate for `oss-cn-hangzhou.aliyuncs.com` and `*.oss-cn-hangzhou.aliyuncs.com`. |
| `harness/host/`, `harness/mut/`, `harness/flyway-probe/`, `harness/fig/` | Host-side runners, mutant lists, the Flyway probe input, card sources. |

Notes for anyone re-running it:

- Paths are rewritten (`/rig` is the rig root). Tokens and keys in the scripts are rig-only dummy values.
- `results/head-c21efbdfa1/s15.console` was produced after a first run hit a full disk in the VM (MySQL binary logs); the spoiled outputs are not included.
- The O2 scenarios talk to a local OSS double through the real `aliyun-sdk-oss`, not to Aliyun OSS.
- TypeScript tests and mutants were run on an idle Linux host, because the loaded macOS host made the unmodified test file flaky.
