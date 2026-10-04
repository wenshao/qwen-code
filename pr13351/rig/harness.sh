#!/bin/bash
# VERIFICATION RIG ONLY: start the packaged Hosted Harness (dist/<label>/cli.js) with a clean environment.
# usage: harness.sh <arm>     env: DIST=<label> (default arm)
set -u
. /Users/wenshao/pr13351-rig/rig.env; . $RIG/ports.sh $1; ARM=$1; D=${DIST:-$ARM}
RUN=$RIG/run/$ARM; H=$RUN/home; mkdir -p $H/.qwen $RUN/decoy $RUN/runtime
cat > $H/.qwen/settings.json <<JSON
{"security":{"auth":{"selectedType":"openai"}},"model":{"name":"rig-model"},"telemetry":{"enabled":false},"ui":{"enableFollowupSuggestions":false},
 "modelProviders":{"openai":[{"id":"rig-model","envKey":"OPENAI_API_KEY","baseUrl":"http://127.0.0.1:$MODEL_PORT/v1"}]}}
JSON
N=$(ls $RUN/harness-*.log 2>/dev/null | wc -l | tr -d ' '); LOG=$RUN/harness-$N.log
DECOY=$(cd $RUN/decoy && pwd -P)
echo "{\"$DECOY\":\"TRUST_FOLDER\"}" > $RUN/trusted.json
cd $DECOY
nohup env -i PATH="$(dirname $NODE):/usr/bin:/bin:/usr/sbin:/sbin" TZ=UTC HOME=$H USERPROFILE=$H QWEN_HOME=$H/.qwen QWEN_RUNTIME_DIR=$RUN/runtime \
  OPENAI_API_KEY=fake-local-key OPENAI_BASE_URL=http://127.0.0.1:$MODEL_PORT/v1 QWEN_SERVER_TOKEN=$HTOKEN QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST=$DIGEST \
  QWEN_CODE_SYSTEM_SETTINGS_PATH=$RUN/sys-settings.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=$RUN/sys-defaults.json QWEN_CODE_TRUSTED_FOLDERS_PATH=$RUN/trusted.json \
  NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
  $NODE $RIG/dist/$D/cli.js serve --profile hosted-harness --hostname 127.0.0.1 --port $HARNESS_PORT --require-auth --no-web --workspace $DECOY \
  --managed-runtime-broker-url http://127.0.0.1:$BROKER_PORT --managed-runtime-broker-token=$BTOKEN > $LOG 2>&1 &
echo $! > $RUN/harness.pid
echo "$D" > $RUN/harness.dist
for i in $(seq 1 90); do
  code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -m 2 -H "Authorization: Bearer $HTOKEN" http://127.0.0.1:$HARNESS_PORT/health 2>/dev/null)
  [ "$code" = "200" ] && { echo "harness[$ARM] dist=$D pid=$(cat $RUN/harness.pid) up after ${i}s log=$LOG"; exit 0; }
  kill -0 $(cat $RUN/harness.pid) 2>/dev/null || { echo "harness[$ARM] DIED"; tail -20 $LOG | cut -c1-300; exit 1; }
  sleep 1
done
echo "harness[$ARM] start TIMEOUT"; tail -20 $LOG | cut -c1-300; exit 1
