#!/usr/bin/env bash
# run-responses.sh <tree> <label> <mode> <failCount>
set -uo pipefail
TREE="$1"; LABEL="$2"; MODE="$3"; FAILN="$4"; PROMPT="${5:-Say hello in three words.}"
H=/root/git/h10347
OUT="$H/out/$LABEL"; rm -rf "$OUT"; mkdir -p "$OUT"
PORT=$(( 19600 + RANDOM % 300 ))
LOG="$OUT/wire.jsonl"; : > "$LOG"
node "$H/mock-llumnix.mjs" --port "$PORT" --mode "$MODE" --fail "$FAILN" --log "$LOG" > "$OUT/mock.log" 2>&1 &
MOCK=$!
for i in $(seq 1 50); do grep -q listening "$OUT/mock.log" && break; sleep 0.1; done
export HOME="$OUT/home"; mkdir -p "$HOME/.qwen"
cat > "$HOME/.qwen/settings.json" <<JSON
{ "security": { "auth": { "selectedType": "openai-responses" } },
  "privacy": { "usageStatisticsEnabled": false } }
JSON
export OPENAI_API_KEY=mock-key
export OPENAI_BASE_URL="http://127.0.0.1:$PORT"
export OPENAI_MODEL=mock-model
WORK="$OUT/work"; mkdir -p "$WORK"
START=$(date +%s)
( cd "$WORK" && timeout 200 node "$TREE/dist/cli.js" --approval-mode yolo -p "$PROMPT" ) > "$OUT/cli.stdout" 2> "$OUT/cli.stderr"
RC=$?; END=$(date +%s)
kill $MOCK 2>/dev/null
echo "label=$LABEL exit=$RC upstream_requests=$(wc -l < "$LOG"|tr -d ' ') elapsed_s=$((END-START))"
grep -o "POST\|/responses" "$OUT/mock.log" >/dev/null 2>&1
tail -3 "$OUT/cli.stderr"
