#!/bin/bash
# VERIFICATION RIG ONLY: serve the Web Shell sources of one arm with vite; the WebShell adapter is proxied to the rig's Java server.
# usage: vite.sh <head|base>
. /Users/wenshao/pr13107-rig/rig.env
ARM=$1; if [ "$ARM" = head ]; then W=$RIG/wt3; PORT=$VITE_HEAD_PORT; else W=$RIG/wt3-base; PORT=$VITE_BASE_PORT; fi
mkdir -p $RIG/run/vite
cp $RIG/fixture/rig-13107.html $RIG/fixture/rig-13107.tsx $W/packages/web-shell/client/e2e/fixtures/
cd $W/packages/web-shell
NO_PROXY=127.0.0.1,localhost QWEN_MANAGED_AGENT_JAVA_URL=http://127.0.0.1:$SPRING_PORT nohup $NODE $W/node_modules/vite/bin/vite.js --port $PORT --strictPort > $RIG/run/vite/$ARM.log 2>&1 &
echo $! > $RIG/run/vite/$ARM.pid
for i in $(seq 1 90); do
  code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -m 3 http://localhost:$PORT/e2e/fixtures/rig-13107.html 2>/dev/null)
  [ "$code" = 200 ] && { echo "vite $ARM pid=$(cat $RIG/run/vite/$ARM.pid) port=$PORT up after ${i}s head=$(git -C $W rev-parse --short HEAD)"; exit 0; }
  kill -0 $(cat $RIG/run/vite/$ARM.pid) 2>/dev/null || { echo "vite $ARM DIED"; tail -20 $RIG/run/vite/$ARM.log; exit 1; }
  sleep 1
done
echo "vite $ARM TIMEOUT"; tail -20 $RIG/run/vite/$ARM.log; exit 1
