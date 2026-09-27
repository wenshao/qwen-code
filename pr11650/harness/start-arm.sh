#!/bin/bash
# usage: start-arm.sh <arm> <wt> <modelPort> <daemonPort> <proxyPort>
set -e
ARM=$1; WT=$2; MP=$3; DP=$4; PP=$5
S=<RIG>
R=/var/tmp/pr11650
H=$R/home-$ARM; WS=$R/ws-$ARM; L=$S/logs/$ARM
rm -rf $H $WS $L; mkdir -p $H/.qwen $WS $L
cat > $H/.qwen/settings.json <<JSON
{
  "security": { "auth": { "selectedType": "openai" } },
  "model": { "name": "probe-model" },
  "modelProviders": { "openai": [ { "id": "probe-model", "name": "probe-model", "baseUrl": "http://127.0.0.1:$MP/v1", "envKey": "OPENAI_API_KEY" } ] },
  "env": { "OPENAI_API_KEY": "dummy" },
  "tools": { "approvalMode": "yolo" },
  "privacy": { "usageStatisticsEnabled": false }
}
JSON
( cd $WS && git init -q && printf 'seed\n' > README.md && git add -A && git -c user.email=p@p -c user.name=p commit -qm seed )
BASEENV="PATH=$PATH HOME=$H TERM=xterm-256color LANG=en_US.UTF-8"
env -i $BASEENV PORT=$MP LOG=$L/model.jsonl WS=$WS nohup node $S/rig/fake-model.mjs > $L/model.out 2>&1 &
echo $! > $L/model.pid
env -i $BASEENV OPENAI_API_KEY=dummy OPENAI_BASE_URL=http://127.0.0.1:$MP/v1 OPENAI_MODEL=probe-model QWEN_CODE_NO_RELAUNCH=true \
  nohup node $WT/${DIST:-dist}/cli.js serve --port $DP --workspace $WS > $L/daemon.out 2>&1 &
echo $! > $L/daemon.pid
env -i $BASEENV PORT=$PP UPSTREAM=$DP LEDGER=$L/proxy.jsonl nohup node $S/rig/proxy.mjs > $L/proxy.out 2>&1 &
echo $! > $L/proxy.pid
echo "started $ARM: model=$(cat $L/model.pid) daemon=$(cat $L/daemon.pid) proxy=$(cat $L/proxy.pid)"
