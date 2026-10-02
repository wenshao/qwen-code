#!/usr/bin/env bash
# Run the PR's own test file inside a real pty at a forced terminal width.
#
# Round 1 found the FIRST commit's test failed at every width because the test
# parser never calls .wrap(), so yargs rendered at min(80, columns) and broke
# "hosted-harness" mid-word. The current test squashes whitespace before
# comparing, which should make it width-independent. That is a claim about a
# timer-free but environment-sensitive code path, so it is re-measured here
# rather than carried forward from round 2.
#
# Usage: tty-unit.sh <tree> <width> <outfile> [vitest args...]
set -uo pipefail
TREE="$1"; WIDTH="$2"; OUT="$3"; shift 3
SESSION="p13141w${WIDTH}$$"
tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -x "$WIDTH" -y 50
tmux send-keys -t "$SESSION" "cd '$TREE/packages/cli' && COLUMNS=$WIDTH npx vitest run --coverage.enabled=false src/commands/serve.test.ts $* 2>&1 | tee '$OUT'; echo TTYRUN_DONE_\$? " Enter
for _ in $(seq 1 240); do
  if tmux capture-pane -p -t "$SESSION" 2>/dev/null | grep -q 'TTYRUN_DONE_'; then break; fi
  sleep 2
done
tmux capture-pane -p -S -400 -t "$SESSION" > "${OUT%.log}-pane.log" 2>/dev/null
tmux kill-session -t "$SESSION" 2>/dev/null || true
CODE=$(grep -o 'TTYRUN_DONE_[0-9]*' "${OUT%.log}-pane.log" | tail -1 | sed 's/TTYRUN_DONE_//')
echo "width=$WIDTH exit=${CODE:-timeout}"
[ "${CODE:-1}" = "0" ]
