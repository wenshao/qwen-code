#!/bin/bash
# usage: daemon.sh <arm> <profile> <port> '<model json>'   (foreground)
ARM=$1; PROF=$2; PORT=$3; MODEL_JSON=$4
R=/root/verify/pr14858
D=$R/daemons/$ARM-$PROF
mkdir -p $D/home/.qwen
cat > $D/home/.qwen/settings.json <<EOT
{"security":{"auth":{"selectedType":"openai"}},"model":$MODEL_JSON,"modelProviders":{"openai":[{"id":"fake","name":"fake","baseUrl":"$(cat $R/fake-url)","envKey":"OPENAI_API_KEY"}]},"privacy":{"usageStatisticsEnabled":false},"telemetry":{"enabled":true,"target":"local","outfile":"$D/telemetry.jsonl"}}
EOT
cd $R/ws
exec env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy -u NO_COLOR -u QWEN_HOME \
  HOME=$D/home USERPROFILE=$D/home QWEN_SANDBOX=false QWEN_CODE_NO_RELAUNCH=1 \
  OPENAI_API_KEY=dummy OPENAI_BASE_URL=$(cat $R/fake-url) OPENAI_MODEL=fake \
  node $R/wt-$ARM/dist/cli.js serve --port $PORT --token tok14858 --workspace $R/ws >> $D/daemon.log 2>&1
