#!/bin/bash
# VERIFICATION RIG ONLY: start the packaged Hosted Harness for one arm on qwen3.8-max through the cutting proxy.
# usage: harness-real.sh <arm>
set -u
. /Users/wenshao/pr13351-rig/rig.env; . $RIG/ports.sh $1; ARM=$1; D=${DIST:-$ARM}
RP=$((MODEL_PORT+10))
RUN=$RIG/run/$ARM; H=$RUN/home-real; mkdir -p $H/.qwen $RUN/decoy $RUN/runtime-real
$NODE $RIG/probe/real-settings.mjs $H/.qwen/settings.json http://127.0.0.1:$RP/v1 $RUN/realcut-upstream.txt || exit 1
nohup $NODE $RIG/probe/realcut.mjs $RP $RUN/realcut-upstream.txt $RUN/realcut.jsonl > $RUN/realcut.log 2>&1 & echo $! > $RUN/realcut.pid
N=$(ls $RUN/harness-*.log 2>/dev/null | wc -l | tr -d ' '); LOG=$RUN/harness-$N.log
DECOY=$(cd $RUN/decoy && pwd -P)
cd $DECOY
nohup env -i PATH="$(dirname $NODE):/usr/bin:/bin:/usr/sbin:/sbin" TZ=UTC HOME=$H USERPROFILE=$H QWEN_HOME=$H/.qwen QWEN_RUNTIME_DIR=$RUN/runtime-real \
  QWEN_SERVER_TOKEN=$HTOKEN QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST=$DIGEST \
  QWEN_CODE_SYSTEM_SETTINGS_PATH=$RUN/sys-settings.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=$RUN/sys-defaults.json QWEN_CODE_TRUSTED_FOLDERS_PATH=$RUN/trusted.json \
  NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
  $NODE $RIG/dist/$D/cli.js serve --profile hosted-harness --hostname 127.0.0.1 --port $HARNESS_PORT --require-auth --no-web --workspace $DECOY \
  --managed-runtime-broker-url http://127.0.0.1:$BROKER_PORT --managed-runtime-broker-token=$BTOKEN > $LOG 2>&1 &
echo $! > $RUN/harness.pid
for i in $(seq 1 90); do
  code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -m 2 -H "Authorization: Bearer $HTOKEN" http://127.0.0.1:$HARNESS_PORT/health 2>/dev/null)
  [ "$code" = "200" ] && { echo "harness-real[$ARM] dist=$D pid=$(cat $RUN/harness.pid) up after ${i}s log=$LOG; $(cat $RUN/realcut.log)"; exit 0; }
  kill -0 $(cat $RUN/harness.pid) 2>/dev/null || { echo "harness DIED"; tail -20 $LOG | cut -c1-300; exit 1; }
  sleep 1
done
echo "harness start TIMEOUT"; exit 1
