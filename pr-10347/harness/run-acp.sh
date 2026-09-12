#!/usr/bin/env bash
# run-acp.sh <tree> <label> <mode> <failCount> [prompt]
# Drives the real ACP transport (the channel/daemon path) against the mock gateway.
set -uo pipefail
TREE="$1"; LABEL="$2"; MODE="$3"; FAILN="$4"; PROMPT="${5:-Say hello in three words.}"
H=/root/git/h10347
OUT="$H/out/$LABEL"; rm -rf "$OUT"; mkdir -p "$OUT"
PORT=$(( 18700 + RANDOM % 400 ))
LOG="$OUT/wire.jsonl"; : > "$LOG"

node "$H/mock-llumnix.mjs" --port "$PORT" --mode "$MODE" --fail "$FAILN" --log "$LOG" > "$OUT/mock.log" 2>&1 &
MOCK=$!
for i in $(seq 1 50); do grep -q listening "$OUT/mock.log" && break; sleep 0.1; done

export HOME="$OUT/home"; mkdir -p "$HOME/.qwen"
cat > "$HOME/.qwen/settings.json" <<JSON
{
  "security": { "auth": { "selectedType": "openai" } },
  "privacy": { "usageStatisticsEnabled": false }
}
JSON
export OPENAI_API_KEY=mock-key
export OPENAI_BASE_URL="http://127.0.0.1:$PORT/v1"
export OPENAI_MODEL=mock-model
WORK="$OUT/work"; mkdir -p "$WORK"

timeout 300 node "$H/acp-probe.mjs" "$TREE" "$WORK" "$PROMPT" "$OUT/acp.jsonl" > "$OUT/acp.result" 2> "$OUT/acp.stderr"
kill $MOCK 2>/dev/null; wait $MOCK 2>/dev/null
{
  echo "label=$LABEL tree=$TREE mode=$MODE fail=$FAILN transport=ACP(stdio)"
  echo "upstream_requests=$(wc -l < "$LOG" | tr -d ' ')"
  echo "--- acp result ---"; cat "$OUT/acp.result"
  echo "--- assistant text / errors seen on the ACP wire ---"
  python3 - "$OUT/acp.jsonl" <<'PY'
import json,sys
for line in open(sys.argv[1]):
    r=json.loads(line)
    m=r['msg']
    if m.get('method')=='session/update':
        u=m.get('params',{}).get('update',{})
        k=u.get('sessionUpdate')
        if k=='agent_message_chunk':
            print('  text:', json.dumps(u.get('content',{}).get('text',''))[:200])
        elif k:
            print('  update:', k)
    if 'error' in m:
        print('  ERROR:', json.dumps(m['error'])[:300])
PY
} | tee "$OUT/summary.txt"
