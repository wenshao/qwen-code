# PR #10916 verification harness, round 3 (head 72f3d0ae04)

Round 3 reuses round 2's scenarios, fake model, MCP server and hook script unchanged
(`../pr-10916-round2/harness/`). The files here are the round-3 drivers plus the setup scripts whose absolute
paths now point at the round-3 rig (`/root/verify/pr10916/r3`).

Arms (each: real `pnpm install --frozen-lockfile`, `npm run build`, `npm run bundle`):
- `main` = origin/main bfb32c780d
- `pr` = 72f3d0ae04 merged with bfb32c780d (clean) -> c72e773b17
- `mut-r71` = a copy of pr's built `dist/` (scripts/, package.json, dist/ copied; node_modules and packages symlinked)
  with one string replaced in `dist/chunks/chunk-ZBKOCS3Y.js`:
  `if(terminateMode==="LOOP_DETECTED"){for(const content of toolCallResult.messages){chat.addHistory(content)}break}`
  -> `if(terminateMode==="LOOP_DETECTED"){break}` (only the 72f3d0ae04 agent-core hunk removed; R7-1 negative control)

Runs:
- `run-r3.sh` — first batch: S12 x3 on pr, S12 on main and mut-r71, S12 with `--telemetry-outfile`, then S1, S9, S13,
  S3b, S8, S4, S10 on pr and main. Every run is `qwen -p --approval-mode yolo`.
- `run-r3-reps.sh` — repeats for runs the pre-existing `Output: (empty)` shell glitch spoiled (S1 x3, S12 x3,
  mut-r71 x1, telemetry x2).
- TUI steer (R6-1): round-1 `pr10916-tui.ts r3/pr s5-steer <out> steer` (node-pty + xterm.js).
- `evidence3.py r71|headless` -> ANSI panels in `../figs/`, rendered with round-1 `pr10916-render.ts` (152 cols).
- `collect3.py` -> `../data/results.json`.

Unit / static (on pr): `src/agents/runtime` + `loopDetectionService` + `client` 2031 passed / 7 skipped;
negative control (agent-core hunk reverted in source with `git apply -R`, then re-applied) fails
`agent-headless.test.ts` 1 / 77; core `tsc --noEmit` exit 0; eslint `--max-warnings 0` and prettier clean;
`full-core.sh` runs the full core suite on both arms plus cli `nonInteractiveCli`.

Glitch accounting (pre-existing; also on main): fast-failing shell commands intermittently report
`Output: (empty)`, which resets the error streak. It hit S12 in 3 of 9 pr runs (`pr-rep2`, `pr-telemetry`,
`pr-telemetry3`, each on `call_s1_a`) and the first S1 pr run (`call_s1_4`). The halt attribution comes from
`s12-stophook-r71__pr-telemetry2` (`loop_detected`, `repeated_tool_error`, subagent prompt id).
