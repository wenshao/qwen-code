#!/bin/bash
# usage: ui-up.sh <arm> <vitePort>  — stack + daemon + vite; pids in runs/ui-<arm>/pids
set -u
ARM=$1; VP=$2; RIG=/Users/wenshao/pr13219-rig; RUN=$RIG/runs/ui-$ARM; W=$RIG/src-$ARM
rm -f $RUN/ui.json
node $RIG/rig/driver.mjs $ARM ui ui-$ARM > $RIG/runs/ui-$ARM.out 2>&1 &
echo "driver $!" > $RIG/out/ui-$ARM.pids
for i in $(seq 1 120); do [ -f $RUN/ui.json ] && break; sleep 1; done
PROXY=$(node -e 'console.log(require(process.argv[1]).proxy)' $RUN/ui.json)
DP=$((VP+100)); DH=$RUN/daemon-home; mkdir -p $DH/.qwen $RUN/daemon-ws
FAKE=$(grep -o 'OPENAI_BASE_URL[^,]*' /dev/null); 
echo '{"ui":{"enableFollowupSuggestions":false}}' > $DH/.qwen/settings.json
(cd $RUN/daemon-ws && HOME=$DH QWEN_HOME=$DH/.qwen OPENAI_API_KEY=x OPENAI_BASE_URL=http://127.0.0.1:9/v1 OPENAI_MODEL=fake exec node $W/dist/cli.js serve --port $DP --hostname 127.0.0.1 --workspace $RUN/daemon-ws > $RUN/daemon.log 2>&1 &
echo "daemon $!" >> $RIG/out/ui-$ARM.pids)
(cd $W/packages/web-shell && QWEN_DAEMON_URL=http://127.0.0.1:$DP QWEN_MANAGED_AGENT_JAVA_URL=http://127.0.0.1:$PROXY BROWSER=none exec $W/node_modules/.bin/vite --port $VP --strictPort > $RUN/vite.log 2>&1 &
echo "vite $!" >> $RIG/out/ui-$ARM.pids)
for i in $(seq 1 60); do curl -s -o /dev/null -w '%{http_code}' http://localhost:$VP/ | grep -q 200 && break; sleep 1; done
echo "ui.json $(cat $RUN/ui.json) daemon=$DP vite=http://localhost:$VP"
cat $RIG/out/ui-$ARM.pids
