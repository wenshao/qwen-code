# PR #10916 verification harness, round 2 (head 3fb6a1f042)

Builds on round 1 (`../pr-10916/harness`, same fake model and drivers).

Arms (each: real `pnpm install --frozen-lockfile`, `npm run build`, `npm run bundle`):
- `main` = origin/main a011f66944
- `pr` = 3fb6a1f042 merged with a011f66944 (clean) -> 09741fcd71
- `fix` = pr + `fix-r7-1-agent-history.patch` (R7-1)
- `mut-r11-1`, `mut-r11-2` = a copy of pr's built `dist/` with one fix reverted in `dist/chunks/chunk-Q4NVQ4SB.js`
  (negative controls; scripts/ and dist/ copied, node_modules and packages symlinked to pr)

Drivers:
- `run-headless.sh <arm> <scenario> <outdir> [cli args]` — real `qwen -p` in a throwaway HOME/workspace;
  `<scenario>.setup.sh` / `<scenario>.settings.json` optional; `EXTRA_ENV=...` passes extra env (S11 uses
  `QWEN_CODE_ENABLE_AGENT_TEAM=1`). Every run here used `--approval-mode yolo`.
- TUI steer run: round-1 `pr10916-tui.ts <arm> s5-steer <out> steer` (node-pty + xterm.js).
- ACP: round-1 `acp-run.mjs <armdir> s1-git-deadend <out>`.
- `evidence2.py headless|r71` -> ANSI panels, rendered with round-1 `pr10916-render.ts`.
- `collect.py` -> `data/results.json`.

New scenarios:
- `s9-mcp-distinct` / `s9-mcp-same` + `mcp-upstream.mjs` — real stdio MCP gateway server (R11-1). distinct: three
  different upstream failures whose text ends in `... with response: 502 Bad Gateway`; same: one identical payload.
- `s10-timeouts` — three different commands, each with shell `timeout: 3000`, each timing out.
- `s11-team-r71` — in-process teammate halted by the guard, then `send_message` (refused: teammate FAILED).
- `s12-stophook-r71` + `subagent-stop-hook.cjs` — R7-1 through a SubagentStop hook that blocks once.
- `s13-bg-drain-r112` — background agent; the fake server sequences the leader's `send_message` so it is drained at
  the immediate-drain branch (R11-2).

Known noise (pre-existing, also on main, see round 1): fast-failing shell commands intermittently report
`Output: (empty)`. It hit S7 here in 3 of 4 pr runs (5 of 15 commands, under load) and one S12 pr run (s12-stophook-r71__pr-telemetry) and resets the error streak;
only `s7-quoted-digest__pr-rep3` is clean.
