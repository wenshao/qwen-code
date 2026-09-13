#!/bin/bash
# start-daemon.sh <arm>   arm = pr | base   (swaps only the web-shell bundle)
set -euo pipefail
source /root/git/h11644/env.sh
ARM="${1:-pr}"
if [ -d "$H/ws-$ARM" ]; then
  rm -rf "$WT/dist/web-shell"; cp -r "$H/ws-$ARM" "$WT/dist/web-shell"; echo "web-shell bundle := $ARM"
else
  echo "no $H/ws-$ARM — using the bundle already in dist/"
fi
cd "$WS"
HOME="$HOME_QWEN" QWEN_RUNTIME_DIR="$QWEN_RUNTIME_DIR" \
OPENAI_API_KEY=mock-key OPENAI_BASE_URL="http://127.0.0.1:$MOCK_PORT/v1" OPENAI_MODEL=mock-model \
node "$WT/dist/cli.js" serve --port "$PORT" --token "$TOKEN" --workspace "$WS" --workspace "$WS2" --workspace "$WS3" \
  > "$H/daemon-$ARM.log" 2>&1 &
echo $! > "$H/daemon.pid"
for i in $(seq 1 80); do
  if curl -fsS -m 2 -H "Authorization: Bearer $TOKEN" "$BASE_URL/health" >/dev/null 2>&1; then
    echo "daemon up on $BASE_URL (pid $(cat $H/daemon.pid), arm=$ARM)"; exit 0
  fi
  sleep 0.5
done
echo "daemon did NOT come up"; tail -30 "$H/daemon-$ARM.log"; exit 1
