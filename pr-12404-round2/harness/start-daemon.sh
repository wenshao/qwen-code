#!/bin/bash
# start-daemon.sh <arm>   arm dir = $WT/.arm-<arm> (a full dist copy); RT=<runtime dir> HQ=<home dir> override.
source /root/verify/pr12404-r2-e2e/env.sh
ARM=$1
cd "$WS"
HOME="$HOME_QWEN" QWEN_RUNTIME_DIR="$QWEN_RUNTIME_DIR" OPENAI_API_KEY=dummy OPENAI_BASE_URL="http://127.0.0.1:$MOCK_PORT/v1" OPENAI_MODEL=mock-model \
  setsid nohup node "$WT/.arm-$ARM/cli.js" serve --port "$PORT" --token "$TOKEN" --workspace "$WS" > "$H/out/daemon-$ARM-$(date +%H%M%S).log" 2>&1 &
echo $! > "$H/daemon.pid"
for i in $(seq 1 80); do curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q 200 && { echo "daemon $ARM up pid $(cat $H/daemon.pid)"; exit 0; }; sleep 0.5; done
echo "daemon $ARM failed"; tail -20 "$H"/out/daemon-$ARM-*.log | tail -20; exit 1
