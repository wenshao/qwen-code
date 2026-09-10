#!/bin/bash
# tui-start.sh <session> <verifier-mode> [dist-index-js] [checkpoint-timeout-s]
set -uo pipefail
source /root/git/h11576/env.sh
S=$1; MODE=$2
DIST=${3:-$WT/packages/cli/dist/index.js}
TMO=${4:-8}
"$H/setup-home.sh" "$TMO" >/dev/null
cat > "$H/out/control.json" <<JSON
{ "runId": "$S", "verifier": "$MODE", "callsPerTurn": ${CALLS_PER_TURN:-60}, "bulkTurns": ${BULK_TURNS:-12}, "tailCalls": 2, "claimCount": ${CLAIM_COUNT:-32} }
JSON
: > "$H/out/wire.jsonl"
"$H/start-mock.sh" >/dev/null
tmux -L "$TMUX_SOCK" kill-session -t "$S" 2>/dev/null
tmux -L "$TMUX_SOCK" new-session -d -s "$S" -x "${COLS:-150}" -y "${ROWS:-42}" -c "$WS" \
  "HOME=$HOME_T OPENAI_API_KEY=mock OPENAI_BASE_URL=http://127.0.0.1:$PORT/v1 OPENAI_MODEL=mock-model QWEN_CODE_SUPPRESS_YOLO_WARNING=1 node $DIST --yolo"
sleep 14
echo "started tmux -L $TMUX_SOCK session $S"
