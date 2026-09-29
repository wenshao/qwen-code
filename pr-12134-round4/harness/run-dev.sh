#!/bin/bash
# usage: run-dev.sh <arm-src-dir> <label> <port>
SRC=$1; LABEL=$2; PORT=$3
cd $SRC
for v in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy; do unset $v; done
QWEN_DAEMON_URL=http://127.0.0.1:4234 setsid nohup node /root/verify/pr12134/head/node_modules/vite/bin/vite.js --port $PORT --strictPort > /root/verify/pr12134/results/vite-$LABEL.log 2>&1 &
for i in $(seq 1 60); do curl -s --noproxy '*' http://localhost:$PORT/ >/dev/null && break; sleep 1; done
cd /root/verify/pr12134/harness
ARM=$LABEL BASE=http://localhost:$PORT OUT=/root/verify/pr12134/results/$LABEL NODE_PATH=/root/verify/pr12134/head/node_modules timeout 600 node drive.cjs parked
for p in $(ps -eo pid,args | awk -v port="--port $PORT" 'index($0, port) && /vite.js/ && !/awk/ {print $1}'); do kill $p; done
