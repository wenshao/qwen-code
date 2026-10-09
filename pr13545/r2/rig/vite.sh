#!/bin/bash
# VERIFICATION RIG ONLY: serve one arm's Web Shell sources with vite, proxying the WebShell adapter to that arm's Spring.
# usage: vite.sh <head|base>
RIG=/Users/wenshao/pr13545-rig; ARM=$1
case $ARM in head) PORT=5545;; base) PORT=5546;; esac
W=$RIG/src-$ARM; SPRING=$(python3 -c "import json;print(json.load(open('$RIG/state/serve-$ARM.json'))['springPort'])")
cd $W/packages/web-shell
NO_PROXY=127.0.0.1,localhost QWEN_MANAGED_AGENT_JAVA_URL=http://127.0.0.1:$SPRING nohup node $W/node_modules/vite/bin/vite.js --port $PORT --strictPort > $RIG/out/vite-$ARM.log 2>&1 &
echo $! > $RIG/state/vite-$ARM.pid
for i in $(seq 1 90); do
  code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -m 3 http://localhost:$PORT/e2e/fixtures/rig-13545.html 2>/dev/null)
  [ "$code" = 200 ] && { echo "vite $ARM pid=$(cat $RIG/state/vite-$ARM.pid) port=$PORT spring=$SPRING up after ${i}s"; exit 0; }
  kill -0 $(cat $RIG/state/vite-$ARM.pid) 2>/dev/null || { echo "vite $ARM DIED"; tail -20 $RIG/out/vite-$ARM.log; exit 1; }
  sleep 1
done
echo "vite $ARM TIMEOUT"; exit 1
