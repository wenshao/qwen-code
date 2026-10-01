# PR #12930 verification harness

Everything here runs against a real build of the PR head (`9162fd0064`). The worktree path needs to contain `qwen`, because the test's `pgrep -f "qwen.*--acp"` matches the ACP child's command line.

| file | purpose |
| --- | --- |
| `fault.cjs` | `NODE_OPTIONS=--require` preload. It activates only in vitest fork workers (`argv[1]` = tinypool `process.js`) and is a no-op in the daemon and ACP child. It wraps `fetch()` for `GET /session/:id/events` and `child_process.execSync` (via `syncBuiltinESMExports`) to write a JSONL timeline to `$PR12930_LOG`. `PR12930_FAULT` = `none`, `delay:<ms>`, `404` (unknown session id), `cut` (body errors after the handshake), `eof` (body ends cleanly), `hold` (body never yields), or `stall` (the open never completes). |
| `run-arm.sh` | One vitest run (`--retry=0`) of the base or head file, either SIGKILL-only (`-t SIGKILL`) or the full file. Appends a row to `results.tsv`. Set `WRAP="taskset -c …"` to pin cores. |
| `matrix1.sh` | e0: natural, 20 runs per arm, interleaved. e1: delay sweep. e3: injected-fault diagnostics. |
| `stress.sh` / `stress5.sh` | e4: 3 pinned cores + 6 busy loops. e5: 2 pinned cores + 10 busy loops. Busy loops are killed by recorded PID. |
| `summarize.cjs` | Recomputes every number in the report from `results.tsv` plus the timelines. |
| `timeline-stats.cjs` | Kill vs SSE-response ordering stats. |
| `gen-figs.cjs` / `render.cjs` | ANSI transcripts, rendered to PNG with real xterm.js and Playwright Chromium. |
| `ci-scan.sh` / `ci-analyze.cjs` | Download each E2E job log (validated, with retries) and grep the SIGKILL test line. The final window statistics come from `ci-finalize.cjs`; its output is `data/ci-history-final.json` and `data/ci-e2e-jobs-window.tsv`. |
| `sync-write-probe.cjs` | Shows that a `fetch()` followed by a synchronous `execSync` does not reach the server until `execSync` returns, even on a pooled keep-alive socket. |

The base arm is `git show 6b66321a5a:integration-tests/cli/qwen-serve-streaming.test.ts`, saved as `integration-tests/cli/armbase-serve-streaming.test.ts` next to the PR's file. Its name is chosen so that neither vitest path filter is a substring of the other.

`data/results.tsv` columns: tag, arm, fault, scope, rc, wall_ms, summary. `e4-base-02` is an invalid run: the base file was briefly moved aside during a typecheck, so vitest reported "No test files found". It is excluded everywhere.
