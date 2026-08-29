#!/usr/bin/env bash
# PR #10083 end-to-end driver.
#   $1 = variant label (pr | main)
#   $2 = absolute path to the built worktree
set -uo pipefail
VARIANT="$1"
REPO="$2"
H=/root/git/pr10083-harness
OUT="$H/out/$VARIANT"
SOCK="pr10083"
SESS="e2e-$VARIANT"
PORT=$((8730 + RANDOM % 200))

rm -rf "$OUT"; mkdir -p "$OUT"
export HOME="$OUT/home"
mkdir -p "$HOME/.qwen" "$OUT/work"
cat > "$HOME/.qwen/settings.json" <<'JSON'
{ "selectedAuthType": "openai", "theme": "Default", "experimental": { "agentTeam": true } }
JSON

# --- mock model -------------------------------------------------------
MOCK_LOG="$OUT/mock.jsonl"
MOCK_KEEP_SUBAGENTS_ALIVE="${KEEP_ALIVE:-0}" MOCK_PORT=$PORT MOCK_PLAN="$H/${PLAN:-plan-pr.json}" MOCK_LOG="$MOCK_LOG" \
  node "$H/mock-model.cjs" > "$OUT/mock.out" 2>&1 &
MOCK_PID=$!
for i in $(seq 1 40); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/v1/models" && break
  sleep 0.25
done
sleep 1
echo "mock pid=$MOCK_PID port=$PORT" | tee "$OUT/meta.txt"

# --- CLI in tmux ------------------------------------------------------
tmux -L "$SOCK" kill-session -t "$SESS" 2>/dev/null
tmux -L "$SOCK" new-session -d -s "$SESS" -x 150 -y 45 -c "$OUT/work" \
  "env HOME='$HOME' \
       OPENAI_API_KEY=mock-key \
       OPENAI_BASE_URL='http://127.0.0.1:$PORT/v1' \
       OPENAI_MODEL=mock-model \
       QWEN_CODE_ENABLE_AGENT_TEAM=1 \
       QWEN_SANDBOX=false \
       NO_COLOR= TERM=xterm-256color \
     node '$REPO/dist/cli.js' --approval-mode yolo"

sleep 12
tmux -L "$SOCK" capture-pane -p -t "$SESS" > "$OUT/00-boot.txt"

PROMPT='__PR10083_MAIN__ run the destination verification scenarios'
tmux -L "$SOCK" send-keys -t "$SESS" "$PROMPT"
sleep 2
tmux -L "$SOCK" send-keys -t "$SESS" Enter

for i in $(seq 1 24); do
  sleep 5
  tmux -L "$SOCK" capture-pane -p -e -t "$SESS" > "$OUT/live.ansi"
  if grep -qE "Scenarios complete|Scenario D complete" "$OUT/live.ansi"; then break; fi
done
sleep 4
tmux -L "$SOCK" capture-pane -p -e -t "$SESS" > "$OUT/final.ansi"
tmux -L "$SOCK" capture-pane -p -e -S -400 -t "$SESS" > "$OUT/scrollback.ansi"
tmux -L "$SOCK" capture-pane -p -S -400 -t "$SESS" > "$OUT/scrollback.txt"

tmux -L "$SOCK" kill-session -t "$SESS" 2>/dev/null
kill $MOCK_PID 2>/dev/null
echo "=== done: $OUT ==="
