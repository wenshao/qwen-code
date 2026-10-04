#!/bin/bash
# VERIFICATION RIG ONLY: serve the Web Shell sources of one arm's worktree with vite, proxied through the wire to that arm's Java server.
# usage: vite.sh <head|base>
. /Users/wenshao/pr13351-rig/rig.env; . $RIG/ports.sh $1; ARM=$1
W=/Users/wenshao/git/pr13351-$ARM
RUN=$RIG/run/$ARM; mkdir -p $RUN
cp $RIG/fixture/rig-13351.html $RIG/fixture/rig-13351.tsx $W/packages/web-shell/client/e2e/fixtures/
cd $W/packages/web-shell
NO_PROXY=127.0.0.1,localhost QWEN_MANAGED_AGENT_JAVA_URL=http://127.0.0.1:$WIRE_PORT nohup $NODE $W/node_modules/vite/bin/vite.js --port $VITE_PORT --strictPort > $RUN/vite.log 2>&1 &
echo $! > $RUN/vite.pid
for i in $(seq 1 120); do
  code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -m 3 http://localhost:$VITE_PORT/e2e/fixtures/rig-13351.html 2>/dev/null)
  [ "$code" = 200 ] && { echo "vite[$ARM] pid=$(cat $RUN/vite.pid) port=$VITE_PORT up after ${i}s head=$(git -C $W rev-parse --short HEAD)"; exit 0; }
  kill -0 $(cat $RUN/vite.pid) 2>/dev/null || { echo "vite[$ARM] DIED"; tail -20 $RUN/vite.log; exit 1; }
  sleep 1
done
echo "vite[$ARM] TIMEOUT"; tail -20 $RUN/vite.log; exit 1
