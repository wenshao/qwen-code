# PR #13088 — real-environment verification, round 2 (head 2cbf89313a; earlier in the round c21efbdfa1)

Evidence for the round-2 report on https://github.com/QwenLM/qwen-code/pull/13088. Round 1 is one directory up.

| Path | Content |
| --- | --- |
| `r2-0*.png` | The evidence cards embedded in the report, rendered from `harness/fig/cards-r2*.mjs`; every value comes from the logs under `results/`. |
| `trial-merge-resolution.diff.txt` | The hand-made part of my local trial merge of c21efbdfa1 with main 78143fe335 (made before the author pushed 2cbf89313a). |
| `results/head-2cbf89313a/` | Console output and scenario logs for the final head (base arm = main 78143fe335), including `s17` (FIFO marker, inspect, Action resolution) and `java-it-fix` (the one-line test fix). |
| `results/head-2cbf89313a-mariadb/` | Identity matrix and restore-from-backup on MariaDB 10.11.18 at 2cbf89313a. |
| `results/head-c21efbdfa1/`, `results/head-c21efbdfa1-mariadb/` | The same for c21efbdfa1 (base arm = main 3a8fd11711), plus the scenarios run only there (O2 load cost, runtime image, Flyway collision probe). |
| `results/trial-merge/` | Scenarios, unit tests and the two W1a ITs on the local trial merge. |
| `results/mutation/` | Java unit-stage and IT-stage mutation, TypeScript mutation (idle Linux host), for both heads. |
| `results/ci/` | Test totals and W1 markers extracted from the GitHub Hosted MySQL jobs of both heads. |
| `harness/vm/` | Scenario scripts run inside the Linux VM (`s13` birth time, `s14`/`s14b`/`s16` O2 publication, `s15` Hosted MCP, `s5b` storage layout, `s17` changes of 2cbf89313a, `s4` reboot, `ReplaceProbe.java`, and the round-1 scripts as used this round). |
| `harness/vm/o2/` | The OSS double and the stdio MCP server. The TLS key pair for the OSS double is not published; generate a private CA and a leaf certificate for `oss-cn-hangzhou.aliyuncs.com` and `*.oss-cn-hangzhou.aliyuncs.com`. |
| `harness/host/`, `harness/mut/`, `harness/flyway-probe/`, `harness/fig/` | Host-side runners, mutant lists (including the candidate test fix `FIX1`), the Flyway probe input, card sources. |

Notes for anyone re-running it:

- Paths are rewritten (`/rig` is the rig root). Tokens and keys in the scripts are rig-only dummy values.
- A first c21efbdfa1 batch hit a full disk in the VM (MySQL binary logs); the spoiled outputs are not included, the reruns are.
- The O2 scenarios talk to a local OSS double through the real `aliyun-sdk-oss`, not to Aliyun OSS.
- TypeScript tests and mutants were run on an idle Linux host, because the loaded macOS host made the unmodified test file flaky.
- 2cbf89313a changes no CLI or core source file; both heads ran the Harness bundle built at c21efbdfa1.
