#!/bin/bash
# VERIFICATION RIG ONLY: serve one arm's WebShell (vite dev) with the rig host page, proxied to the rig's Java server.
# usage: vite.sh <head|base>
. /root/v13163/rig/rig.env
A=$1; [ "$A" = base ] && PORT=$VITE_BASE_PORT || PORT=$VITE_HEAD_PORT
cp $RIG/fixture/rig-13163.html $RIG/fixture/rig-13163.tsx /root/v13163/$A/packages/web-shell/client/e2e/fixtures/
cd /root/v13163/$A/packages/web-shell
VB=./node_modules/.bin/vite; [ -x $VB ] || VB=../../node_modules/.bin/vite
setsid nohup env QWEN_MANAGED_AGENT_JAVA_URL=http://127.0.0.1:$SPRING_PORT $VB --port $PORT --strictPort --host 127.0.0.1 > $RIG/run/vite-$A.log 2>&1 < /dev/null &
echo $! > $RIG/run/vite-$A.pid
for i in $(seq 1 60); do
  c=$(curl -s -o /dev/null -w '%{http_code}' -m 2 http://127.0.0.1:$PORT/e2e/fixtures/rig-13163.html)
  [ "$c" = 200 ] && { echo "vite $A up on $PORT after ${i}s"; exit 0; }
  sleep 1
done
echo "vite $A TIMEOUT"; tail -20 $RIG/run/vite-$A.log
