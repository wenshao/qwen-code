#!/bin/bash
# VERIFICATION RIG ONLY (PR #13037)
# usage: start.sh <jarArm> <db>   (env as spring.sh; SHELL_PROFILE=1 swaps the tool profile in the tap; NO_HARNESS=1)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/19f717cd-fa69-4495-b803-21c540ab1bd6/scratchpad; R=$S/rig
NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
ARM=$1; DB=$2; TAG=$ARM-$DB
alive() { [ -f $R/run/$1.pid ] && kill -0 $(cat $R/run/$1.pid) 2>/dev/null; }
alive oss || { OSS_DATA=$R/oss-data OSS_ADMIN_PORT=18937 nohup $NODE $R/fake-oss.mjs > $S/logs/oss.log 2>&1 & echo $! > $R/run/oss.pid; sleep 1; }
alive model || { nohup $NODE $R/model.mjs 15037 $R/run/model-requests.jsonl > $S/logs/model.log 2>&1 & echo $! > $R/run/model.pid; }
touch $R/run/model-requests.jsonl
alive tap || { nohup $NODE $R/tap.mjs 16037 17037 $R/run/tap.jsonl > $S/logs/tap.log 2>&1 & echo $! > $R/run/tap.pid; }
nohup $R/spring.sh $ARM $DB "${@:3}" > $S/logs/spring-$TAG.log 2>&1 & echo $! > $R/run/spring.pid
for i in $(seq 1 300); do grep -q "Started ManagedAgentServerApplication" $S/logs/spring-$TAG.log && break; kill -0 $(cat $R/run/spring.pid) 2>/dev/null || { echo SPRING_DIED; tail -5 $S/logs/spring-$TAG.log; exit 1; }; sleep 1; done
grep -o "Started ManagedAgentServerApplication in [0-9.]* seconds" $S/logs/spring-$TAG.log || { echo SPRING_NOT_STARTED; exit 1; }
if [ "${NO_HARNESS:-}" != 1 ]; then
  nohup $R/harness.sh > $S/logs/harness-$TAG.log 2>&1 & echo $! > $R/run/harness.pid
  for i in $(seq 1 180); do curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer rig-o3-token" http://127.0.0.1:16037/capabilities 2>/dev/null | grep -q 200 && break; sleep 1; done
  echo "harness via tap: $(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer rig-o3-token' http://127.0.0.1:16037/capabilities)"
fi
