#!/usr/bin/env bash
# run-e2e.sh <tree> <label> <mode> <failCount> [prompt] [extra-gen-config-json]
# Starts the mock llumnix gateway, runs the real headless CLI against it, and
# prints the wire-level attempt count plus the CLI's own output.
set -uo pipefail
TREE="$1"; LABEL="$2"; MODE="$3"; FAILN="$4"; PROMPT="${5:-Say hello in three words.}"; GEN="${6:-{\}}"
H=/root/git/h10347
OUT="$H/out/$LABEL"; rm -rf "$OUT"; mkdir -p "$OUT"
PORT=$(( 18300 + RANDOM % 400 ))
LOG="$OUT/wire.jsonl"; : > "$LOG"

node "$H/mock-llumnix.mjs" --port "$PORT" --mode "$MODE" --fail "$FAILN" --log "$LOG" > "$OUT/mock.log" 2>&1 &
MOCK=$!
for i in $(seq 1 50); do grep -q listening "$OUT/mock.log" && break; sleep 0.1; done

export HOME="$OUT/home"; mkdir -p "$HOME/.qwen"
cat > "$HOME/.qwen/settings.json" <<JSON
{
  "security": { "auth": { "selectedType": "openai" } },
  "model": { "generationConfig": $GEN },
  "privacy": { "usageStatisticsEnabled": false },
  "ui": { "hideBanner": true }
}
JSON
export OPENAI_API_KEY=mock-key
export OPENAI_BASE_URL="http://127.0.0.1:$PORT/v1"
export OPENAI_MODEL=mock-model
export QWEN_CODE_TELEMETRY_DISABLED=1

WORK="$OUT/work"; mkdir -p "$WORK"
START=$(date +%s.%N)
( cd "$WORK" && timeout 300 node "$TREE/dist/cli.js" --approval-mode yolo -p "$PROMPT" ) \
  > "$OUT/cli.stdout" 2> "$OUT/cli.stderr"
RC=$?
END=$(date +%s.%N)
kill $MOCK 2>/dev/null; wait $MOCK 2>/dev/null

ATTEMPTS=$(wc -l < "$LOG" | tr -d ' ')
ELAPSED=$(python3 -c "print(round($END-$START,1))")
{
  echo "label=$LABEL tree=$TREE mode=$MODE fail=$FAILN gen=$GEN"
  echo "exit=$RC upstream_requests=$ATTEMPTS elapsed_s=$ELAPSED"
  echo "--- request timeline (ms since first) ---"
  python3 - "$LOG" <<'PY'
import json,sys
rows=[json.loads(l) for l in open(sys.argv[1])]
if rows:
    t0=rows[0]['t']
    for r in rows: print(f"  #{r['seq']:2d} +{r['t']-t0:6d}ms stream={r['stream']} {'FAIL' if r['willFail'] else 'OK'}")
PY
  echo "--- cli stdout ---"; cat "$OUT/cli.stdout"
  echo "--- cli stderr (tail) ---"; tail -20 "$OUT/cli.stderr"
} | tee "$OUT/summary.txt"
