#!/bin/bash
# start-daemon.sh <arm>   arm = pr | base ; runs node $WT/.arm-<arm>/cli.js serve
set -euo pipefail
source /root/git/h12404-e2e/env.sh
ARM="${1:-pr}"
CLI="$WT/.arm-$ARM/cli.js"
test -f "$CLI" || { echo "missing $CLI"; exit 1; }
cd "$WS"
HOME="$HOME_QWEN" QWEN_RUNTIME_DIR="${RT:-$QWEN_RUNTIME_DIR}" \
OPENAI_API_KEY=mock-key OPENAI_BASE_URL="http://127.0.0.1:$MOCK_PORT/v1" OPENAI_MODEL=mock-model \
node "$CLI" serve --port "$PORT" --token "$TOKEN" --workspace "$WS" \
  >> "$H/out/daemon-$ARM.log" 2>&1 &
echo $! > "$H/daemon.pid"
for i in $(seq 1 120); do
  if curl -fsS -m 2 -H "Authorization: Bearer $TOKEN" "$BASE_URL/health" >/dev/null 2>&1; then
    echo "daemon up on $BASE_URL (pid $(cat $H/daemon.pid), arm=$ARM, runtime=${RT:-$QWEN_RUNTIME_DIR})"; exit 0
  fi
  sleep 0.5
done
echo "daemon did NOT come up"; tail -30 "$H/out/daemon-$ARM.log"; exit 1
