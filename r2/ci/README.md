# `Test (ubuntu-latest)` on GitHub-hosted runners: `Timeout calling "onTaskUpdate"`

- `test-ubuntu-jobs-09-19_09-22.txt` — every `Test (ubuntu)` job (latest attempt) in `ci.yml` runs created 09-19..09-22, by runner pool and conclusion
- `base-tree-vs-timeout.txt` — per sampled job: runner, whether the log has the RPC timeout, and the `base-tree.test.ts` line (tests, duration)
  (`job-*`/`<run id>` = PR runs, `main-*` = main pushes, `ci-test-ubuntu*` = this PR, attempts 2 and 3)
- `loop-probe.setup.ts` — observation-only vitest setup file: a 100 ms interval in the worker records the longest stretch the event loop did not turn
- `loop-gaps-arm-{A,B,C}.jsonl` + `run-arm-*-summary.txt` — local runs on `origin/main 5feb7a4f34` + PR head, `CI=true`, cli's own vitest config plus the probe:
  A = `base-tree.test.ts` as on main; B = `compose-review.test.ts` + `Session.test.ts` (control); C = A plus `candidate-yield.diff`
  (the one remaining failure in A and C is the macOS-only `EILSEQ` non-UTF-8 filename case)
