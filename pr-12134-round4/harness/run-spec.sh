#!/bin/bash
# usage: run-spec.sh <arm-dir> <label> <port>
DIR=$1; LABEL=$2; PORT=$3
for v in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy; do unset $v; done
SPEC=client/e2e/web-shell.sticky-plan.spec.ts
cp /root/verify/pr12134/harness/web-shell.sticky-plan.spec.ts $DIR/$SPEC
cd $DIR
setsid nohup node /root/verify/pr12134/head/node_modules/vite/bin/vite.js --host 127.0.0.1 --port $PORT --strictPort > /root/verify/pr12134/results/spec-vite-$LABEL.log 2>&1 &
for i in $(seq 1 60); do curl -s --noproxy '*' http://127.0.0.1:$PORT/ >/dev/null && break; sleep 1; done
PLAYWRIGHT_PORT=$PORT PLAYWRIGHT_BASE_URL=http://127.0.0.1:$PORT /root/verify/pr12134/head/node_modules/.bin/playwright test --config playwright.config.ts $SPEC --project=chromium --reporter=line --retries=0 ${REPEAT:+--repeat-each=$REPEAT} --output=/root/verify/pr12134/results/spec-$LABEL > /root/verify/pr12134/results/spec-$LABEL.log 2>&1
echo "$LABEL EXIT=$?"
grep -E "✓|✘|passed|failed|Error:|Expected|Received" /root/verify/pr12134/results/spec-$LABEL.log | head -20
for p in $(ps -eo pid,args | awk -v port="--port $PORT" 'index($0, port) && /vite.js/ && !/awk/ {print $1}'); do kill $p; done
rm -f $DIR/$SPEC
