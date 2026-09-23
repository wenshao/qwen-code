#!/bin/bash
set -euo pipefail
export ARM="${1:-obs}"
source "$(dirname "$0")/env.sh"
mkdir -p "$WS" "$RT" "$HOME_Q/.qwen" "$R/out"
cp "$R/settings.json" "$HOME_Q/.qwen/settings.json"
[ -d "$WS/.git" ] || (cd "$WS" && git init -q && mkdir -p sub slowcd && echo "# ws $ARM" > README.md && echo sub > sub/NOTE.md && echo slow > slowcd/NOTE.md && git add . && git -c user.email=h@h -c user.name=h commit -qm init)
if ! curl -fsS -m 1 "http://127.0.0.1:$MOCK_PORT/__log" >/dev/null 2>&1; then
  MOCK_PORT=$MOCK_PORT MOCK_OUT="$R/out/mock-$ARM" nohup node "$R/mock-llm.mjs" > "$R/out/mock-$ARM.log" 2>&1 &
  echo $! > "$R/out/mock-$ARM.pid"
  sleep 0.6
fi
cd "$WS"
env -i PATH="$PATH" HOME="$HOME_Q" QWEN_RUNTIME_DIR="$RT" TERM=dumb PROBE_SLOW_CD_MS=12000 \
  OPENAI_API_KEY=mock-key OPENAI_BASE_URL="http://127.0.0.1:$MOCK_PORT/v1" OPENAI_MODEL=mock-model \
  nohup node "$DIST/cli.js" serve --port "$PORT" --token "$TOKEN" --workspace "$WS" \
  > "$R/out/daemon-$ARM.log" 2>&1 &
echo $! > "$R/out/daemon-$ARM.pid"
for i in $(seq 1 160); do
  if curl -fsS -m 2 -H "Authorization: Bearer $TOKEN" "$BASE_URL/health" >/dev/null 2>&1; then
    echo "daemon up $BASE_URL arm=$ARM pid=$(cat $R/out/daemon-$ARM.pid) dist=$DIST"; exit 0
  fi
  sleep 0.5
done
echo "daemon did NOT come up"; tail -40 "$R/out/daemon-$ARM.log"; exit 1
