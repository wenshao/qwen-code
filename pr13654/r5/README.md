# PR #13654 round 5: head `fe0ae13e`

`fe0ae13e` merges `main` `a8990042` into the round-4 head `569befb8`. Earlier rounds are in `../` (round 1), `../r2/`, `../r3/` and `../r4/`.

## Files

- `01-merge.png`: the merge commit itself, CI's full `managed-agent-server` command, migration V68 and the packaged-stack scenarios from round 4, all re-run at `fe0ae13e`.
- `02-bot-round-8.png`: probes for the bot's round-8 findings R8-1 and R6-1 (fix-induced).

## Harness

- `harness/cmp-resolve.sh <sha>` checks a resolution commit. It confirms that:
  - the first parent is the round-4 head;
  - the second parent is on `main`;
  - only the conflicted path differs from the automatic merge;
  - the PR's own files are unchanged.
- `harness/build-merge.sh`, `harness/verify-merge.sh` and `harness/summ-total.py` cover the build and the full suite.
  - `verify-merge.sh` runs CI's command (`-Pmysql-integration clean verify checkstyle:check`) against MySQL 8.4.7 instead of MariaDB 10.11.18.
  - It runs with `-Dmaven.test.failure.ignore=true`, so the Maven exit code does not reflect test failures; read `results/full-suite-fe0ae13e.txt` instead.
- `harness/rerun-it.sh` reruns one IT alone.
- `harness/probe/` holds the round-5 probes:
  - `install.sh` copies the PR's `ToolPublicationAsyncVerificationTest` and its MySQL IT into `RigR5ProbeTest` / `RigR5ProbeMySqlIT`. It then inserts the round-3, round-4 and round-5 probe methods, and gives the bucket double an injectable `DELETE` failure and a first-read hook.
  - `run.sh` runs O, B, S and K3 on H2 and MySQL 8.4.7, then deletes the probe sources again.
  - The round-3 and round-4 probe sources are in `../r4/harness/`.
- `harness/rig/` holds the packaged-stack scripts:
  - `r7.sh`: the round-4 scenarios on `fe0ae13e`.
  - `r8.sh`: R8-1 on the stack.
  - `flyway-r7.sh`: the migration checks.
  - `objcheck.py`: catalog state of each object, plus whether the bytes in the OSS double still match the catalog sha256.
  - `s654.ts`: the driver. It gained `HOLD_ACTION=sql-then-release` with `SQL_DURING`, which runs one SQL statement while readback is held.

## Results

- `results/merge-commit-check.txt` shows:
  - the output of `cmp-resolve.sh`;
  - tree equality with my earlier local merge combined with `a8990042`;
  - the PR file blobs.
- `results/workflow-pin-tests.txt`: 7 workflow pin test files plus the Flyway guard, all at `fe0ae13e`.
- `results/workflow-pin-negative-25min.txt`: the same tree with the PR's `timeout-minutes: 25` kept. The workflow pin test fails.
- `results/full-suite-fe0ae13e.txt`: totals and the two failures.
- `results/hook-it-reruns.txt` and `results/macos-non-utf8-filename.txt` explain those two failures.
- `results/flyway.log`: G1–G3.
- `results/contract-and-r6-1.log` and `results/r6-1-terminal-check.txt`: R1–R8 on the stack.
- `results/r8-1-stack.log` and `results/r8-1-stack-objcheck.txt`: R8-1 on the stack. The runs are:
  - R1: control, 12 s hold;
  - R2: 12 s hold with recovery blocked;
  - R3: 4 s hold with recovery blocked;
  - R4: async off, recovery blocked.
- `results/probe-r5.txt`: every probe line, on H2 and MySQL.
