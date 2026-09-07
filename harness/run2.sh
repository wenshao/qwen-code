#!/usr/bin/env bash
set -uo pipefail
ROOT=/root/git/tl-daemon
TOKEN=tl-verify-token-11269
DPORT=47781
FPORT=48722
WS=$ROOT/ws
OUT=$ROOT/out
rm -rf "$OUT"; mkdir -p "$OUT" "$ROOT/logs"

PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null; done; sleep 1; }
trap cleanup EXIT

echo "== fake model =="
FAKE_MODEL_PORT=$FPORT FAKE_MODEL_SLOW_MS=${SLOW_MS:-25000} \
  node "$ROOT/fake-model.mjs" > "$ROOT/logs/model.log" 2>&1 &
PIDS+=($!)

echo "== daemon =="
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME="$ROOT/home" QWEN_HOME="$ROOT/home/.qwen" \
  OPENAI_BASE_URL="http://127.0.0.1:$FPORT/v1" \
  OPENAI_API_KEY=fake-key OPENAI_MODEL=fake-model NO_COLOR=1 \
  node /root/git/qwen-code-x8/dist/cli.js serve \
    --port $DPORT --hostname 127.0.0.1 --token "$TOKEN" --workspace "$WS" \
  > "$ROOT/logs/daemon.log" 2>&1 &
PIDS+=($!)

echo -n "waiting for daemon"
for i in $(seq 1 120); do
  curl -sf -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$DPORT/capabilities" >/dev/null 2>&1 && { echo " ready"; break; }
  echo -n .; sleep 1
done

run_arm() {
  local ARM=$1 DIR=$2 PORT=$3
  echo "===== ARM $ARM ($DIR :$PORT) ====="
  local SID REQ
  REQ=$(python3 -c 'import uuid;print(uuid.uuid4())')
  SID=$(curl -s -X POST "http://127.0.0.1:$DPORT/session" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -H "x-qwen-client-id: tl-$ARM" \
    -d "{\"workspaceCwd\":\"$WS\",\"approvalMode\":\"yolo\",\"sessionId\":\"$REQ\"}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("sessionId",""))')
  echo "session=$SID"
  [ -n "$SID" ] || { echo "session creation failed"; return 1; }

  rm -rf "$DIR/node_modules/.vite"
  ( cd "$DIR" && QWEN_DAEMON_URL="http://127.0.0.1:$DPORT" \
      npx vite --host 127.0.0.1 --port "$PORT" > "$ROOT/logs/vite-$ARM.log" 2>&1 & echo $! > "$ROOT/logs/vite-$ARM.pid" )
  echo -n "waiting for vite :$PORT"
  for i in $(seq 1 180); do
    curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && { echo " ready"; break; }
    echo -n .; sleep 1
  done

  ARM="$ARM" CLIENT_URL="http://127.0.0.1:$PORT" QWEN_TOKEN="$TOKEN" \
    DAEMON_URL="http://127.0.0.1:$DPORT" SESSION_ID="$SID" \
    WORKSPACE_CWD="$WS" OUT_DIR="$OUT" \
    node "$ROOT/drive-one.mjs" 2>&1 | tee "$ROOT/logs/drive-$ARM.log"
  local rc=${PIPESTATUS[0]}
  kill "$(cat "$ROOT/logs/vite-$ARM.pid")" 2>/dev/null
  sleep 3
  echo "arm $ARM exit=$rc"
  return $rc
}

run_arm base /root/git/qwen-code-x8/packages/web-shell 45196
run_arm head /root/git/pr11269/packages/web-shell 45195
echo "== done =="
