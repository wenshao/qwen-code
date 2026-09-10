#!/bin/bash
# arm.sh <label> <verifier-mode> [dist-index-js] [checkpoint-timeout-s]
set -uo pipefail
source /root/git/h11576/env.sh
LABEL=$1; MODE=$2
DIST=${3:-$WT/packages/cli/dist/index.js}
TMO=${4:-8}
CPT=${CALLS_PER_TURN:-60}
BT=${BULK_TURNS:-2}

"$H/setup-home.sh" "$TMO" >/dev/null
cat > "$H/out/control.json" <<JSON
{ "runId": "$LABEL", "verifier": "$MODE", "callsPerTurn": $CPT, "bulkTurns": $BT, "tailCalls": 2, "claimCount": ${CLAIM_COUNT:-32} }
JSON
: > "$H/out/wire.jsonl"
"$H/start-mock.sh" >/dev/null

cd "$WS"
start=$(date +%s)
HOME="$HOME_T" OPENAI_API_KEY=mock OPENAI_BASE_URL="http://127.0.0.1:$PORT/v1" OPENAI_MODEL=mock-model \
  timeout "${RUN_TIMEOUT:-900}" node "$DIST" --yolo -p "${PROMPT:-/goal Collect probe evidence from the shell}" \
  > "$H/out/$LABEL.stdout" 2> "$H/out/$LABEL.stderr"
rc=$?
echo "[$LABEL] mode=$MODE dist=$DIST cli_exit=$rc elapsed=$(( $(date +%s) - start ))s"
rm -rf "$H/out/$LABEL.projects"; cp -r "$HOME_T/.qwen/projects" "$H/out/$LABEL.projects" 2>/dev/null
cp "$H/out/wire.jsonl" "$H/out/$LABEL.wire.jsonl"
HOME_T="$HOME_T" node "$H/goalstate.mjs" ladder | tee "$H/out/$LABEL.ladder"
