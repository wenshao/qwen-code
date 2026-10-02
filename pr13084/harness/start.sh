#!/bin/bash
# VERIFICATION RIG ONLY (PR #13084). usage: start.sh <jarArm> <db> [extra spring args]   (NO_HARNESS=1 skips the Harness)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad; R=$S/rig
NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
ARM=$1; DB=$2; TAG=$ARM-$DB
alive() { [ -f $R/run/$1.pid ] && kill -0 $(cat $R/run/$1.pid) 2>/dev/null; }
alive oss || { OSS_DATA=$R/oss-data DATA_PORT=18484 ADMIN_PORT=18485 nohup $NODE $R/fake-oss.mjs > $S/logs/oss.log 2>&1 & echo $! > $R/run/oss.pid; sleep 1; }
alive model || { nohup $NODE $R/model.mjs 15084 $R/run/model-requests.jsonl > $S/logs/model.log 2>&1 & echo $! > $R/run/model.pid; }
touch $R/run/model-requests.jsonl
alive tap || { nohup $NODE $R/tap.mjs 16084 17084 $R/run/tap.jsonl > $S/logs/tap.log 2>&1 & echo $! > $R/run/tap.pid; }
LOG=$S/logs/spring-$TAG.log; [ -f $LOG ] && mv $LOG $LOG.$(date +%H%M%S)
nohup $R/spring.sh $ARM $DB "${@:3}" > $LOG 2>&1 & echo $! > $R/run/spring.pid
for i in $(seq 1 300); do grep -q "Started ManagedAgentServerApplication" $LOG && break; kill -0 $(cat $R/run/spring.pid) 2>/dev/null || { echo SPRING_DIED; grep -m3 -E "Exception|ERROR|Caused by" $LOG | cut -c1-400; exit 1; }; sleep 1; done
grep -o "Started ManagedAgentServerApplication in [0-9.]* seconds" $LOG || { echo SPRING_NOT_STARTED; exit 1; }
if [ "${NO_HARNESS:-}" != 1 ]; then
  alive harness || { nohup $R/harness.sh > $S/logs/harness-$TAG.log 2>&1 & echo $! > $R/run/harness.pid; }
  for i in $(seq 1 180); do curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer rig-o41-token" http://127.0.0.1:16084/capabilities 2>/dev/null | grep -q 200 && break; sleep 1; done
  echo "harness via tap: $(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer rig-o41-token' http://127.0.0.1:16084/capabilities)"
fi
