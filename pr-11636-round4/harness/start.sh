#!/bin/bash
set -euo pipefail
export ARM="${1:-head}"
source "$(dirname "$0")/env.sh"
mkdir -p "$WS" "$RT" "$HOME_Q/.qwen" "$H/out"
[ -f "$HOME_Q/.qwen/settings.json" ] || cp "$H/settings.json" "$HOME_Q/.qwen/settings.json"
[ -d "$WS/.git" ] || (cd "$WS" && git init -q && echo "# ws $ARM" > README.md && git add . && git -c user.email=h@h -c user.name=h commit -qm init)

if ! curl -fsS -m 1 "http://127.0.0.1:$MOCK_PORT/__log" >/dev/null 2>&1; then
  MOCK_PORT=$MOCK_PORT MOCK_OUT="$H/out/mock-$ARM" nohup node "$H/mock-llm.mjs" > "$H/out/mock-$ARM.log" 2>&1 &
  sleep 0.6
fi

cd "$WS"
HOME="$HOME_Q" QWEN_RUNTIME_DIR="$RT" \
OPENAI_API_KEY=mock-key OPENAI_BASE_URL="http://127.0.0.1:$MOCK_PORT/v1" OPENAI_MODEL=mock-model \
nohup node "$WT/dist/cli.js" serve --port "$PORT" --token "$TOKEN" --workspace "$WS" \
  > "$H/out/daemon-$ARM.log" 2>&1 &
echo $! > "$H/out/daemon-$ARM.pid"
for i in $(seq 1 160); do
  if curl -fsS -m 2 -H "Authorization: Bearer $TOKEN" "$BASE_URL/health" >/dev/null 2>&1; then
    echo "daemon up $BASE_URL arm=$ARM pid=$(cat $H/out/daemon-$ARM.pid) wt=$WT"; exit 0
  fi
  sleep 0.5
done
echo "daemon did NOT come up"; tail -40 "$H/out/daemon-$ARM.log"; exit 1
