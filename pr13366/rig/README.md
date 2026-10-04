# PR #13366 real-stack rig (macOS arm64)

- `build-ts.sh <arm…>`: `node scripts/setup-worktree.js && npm run build && npm run bundle` per worktree (base 8a1a2efe27, head 0dccd187d7, merge = head merged onto main 35616f3b64).
- `build-jar.sh <arm>`: JDK 21, isolated m2, `qwencode install` → `runtime-broker clean install` → `managed-agent-server clean package`.
- `gen-rig.mjs`: derives `scripts/rig-sws.ts` from the issue runner (`scripts/run-managed-agent-server-e2e.ts`, uncommitted `--second-workspace-session` working copy, sha256 1ac8fb2340b5ba17…) with exact-anchor edits (each must match the stated count):
  child-output tee, streaming Harness→Broker tap (`RIG_TAP=1`), async mysql sampler, per-label fake-model delays (`RIG_FIRST_<L>_MS`, `RIG_HOLD_<L>_MS`, `RIG_FINAL_ERROR_<L>`), extra Spring env (`RIG_SPRING_ENV_JSON`), and `driver-block.ts` in place of the mode's assertions.
- `driver-block.ts`: N Sessions (`RIG_ORDER`, `RIG_GAP_MS`) through the public API; `RIG_CANCEL=<L>@<ms>`, `RIG_FOLLOWUP=<L>` (`RIG_FOLLOWUP_EAGER=1`), `RIG_PEEK=<L>@<ms>`; records terminals, lease-row transitions (`managed_workspace_execution_lease`, 100 ms), queue notices, tool rows, files, cross-talk.
- `batch.sh` scenarios: core, issue (unmodified runner), three, long, cancelq, deadline, holdercancel, holderfail. `sum.mjs` → `results/results.tsv`.
- `mut.mjs`: one anchored edit of `hosted-workspace-tool-turn.ts` per mutant, PR suites run twice, killed = red both times; file restored and `git diff --quiet` asserted.
- `fig/`: HTML cards rendered by Playwright; timelines are drawn from each run's tap + lease samples.
