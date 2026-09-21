# PR #12374 round-3 harness (Linux)

- `env.sh` — worktree paths (PR tree `5945a4a7d6`, base `main ec109102e0`), tmux socket `pr12374`, arm table.
- `scripts/mkscenario.sh <dir>` — isolated `HOME` / `QWEN_HOME` / `QWEN_RUNTIME_DIR` / workspace, `cleanupPeriodDays: 30`.
- `scripts/seed-fixture.py <dir>` — the 17-entry S1 debug dir (exact ages, dir-named `.txt`, outside-pointing symlink, `latest`, `daemon/`).
- `scripts/run-tui.sh <pr|base|noallow> <dir> <session> [cli args]` — real interactive TUI in tmux; `TUI_DEBUG=1` turns on `QWEN_DEBUG_LOG_FILE`.
- `scripts/serve.sh <arm> <dir> <port>` — real `qwen serve` with `QWEN_DEBUG_LOG_FILE=1` (S2/S4).
- `scripts/snap.py` / `scripts/corpus-snap.py` — before/after snapshots (names, kinds, ages; corpus = aggregates only).
- `scripts/ambient-ab.sh` — R1-6/7 A/B: ambient `QWEN_RUNTIME_DIR` sentinel, round-2 vs round-3 test files, uid 1500.
- `scripts/mutate.py` — 12 source-level mutants; each restored by re-writing the original bytes.
- `scripts/show-*.sh` + `scripts/ansi2png.py` — the terminal figures (`tmux capture-pane -e` → PNG).
- `noallow` arm = PR `dist/` copy with `PSEUDO_DEBUG_SESSION_STEMS = new Set([])` in `dist/chunks` (round-2 behaviour for the two names).
