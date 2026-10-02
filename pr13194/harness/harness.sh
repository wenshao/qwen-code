#!/bin/bash
# VERIFICATION RIG ONLY: packaged Hosted Harness inside the container.  usage: harness.sh <db> [dist-label]
set -u
. /Users/wenshao/pr13135-rig/lx/env.sh
DB=$1; D=${2:-head}
RUN=$VAR/run/$DB; H=$RUN/home; mkdir -p $H/.qwen $RUN/decoy $RUN/runtime; LOGD=$RIG/run/lx-$DB; mkdir -p $LOGD
cat > $H/.qwen/settings.json <<JSON
{"security":{"auth":{"selectedType":"openai"}},"model":{"name":"rig-model"},"telemetry":{"enabled":false},
 "modelProviders":{"openai":[{"id":"rig-model","envKey":"OPENAI_API_KEY","baseUrl":"http://127.0.0.1:$MODEL_PORT/v1"}]}}
JSON
N=$(ls $LOGD/harness-*.log 2>/dev/null | wc -l | tr -d ' '); LOG=$LOGD/harness-$N.log
cd $RUN/decoy
nohup env -i PATH="$(dirname $NODE):/usr/bin:/bin:/usr/sbin:/sbin" TZ=UTC HOME=$H USERPROFILE=$H QWEN_HOME=$H/.qwen QWEN_RUNTIME_DIR=$RUN/runtime \
  OPENAI_API_KEY=fake-local-key OPENAI_BASE_URL=http://127.0.0.1:$MODEL_PORT/v1 QWEN_SERVER_TOKEN=$HTOKEN QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST=$DIGEST \
  QWEN_CODE_SYSTEM_SETTINGS_PATH=$RUN/sys-settings.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=$RUN/sys-defaults.json QWEN_CODE_TRUSTED_FOLDERS_PATH=$RUN/trusted.json \
  $NODE $RIG/dist/$D/cli.js serve --profile hosted-harness --http-bridge --hostname 127.0.0.1 --port $HARNESS_PORT --require-auth --no-web --workspace $RUN/decoy \
  --managed-runtime-broker-url http://127.0.0.1:$BROKER_PORT --managed-runtime-broker-token $BTOKEN > $LOG 2>&1 &
echo $! > $RUN/harness.pid
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 2 -H "Authorization: Bearer $HTOKEN" http://127.0.0.1:$HARNESS_PORT/capabilities 2>/dev/null)
  [ "$code" = "200" ] && { echo "harness pid=$(cat $RUN/harness.pid) up after ${i}s log=$LOG"; exit 0; }
  kill -0 $(cat $RUN/harness.pid) 2>/dev/null || { echo "harness DIED"; tail -20 $LOG | cut -c1-300; exit 1; }
  sleep 1
done
echo "harness start TIMEOUT"; tail -20 $LOG | cut -c1-300; exit 1
