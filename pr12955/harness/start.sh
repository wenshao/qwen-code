#!/bin/bash
# usage: start.sh <jarArm> <db> [cliArm]   (env FILES, STORAGES, ...) -- starts tap, spring, harness
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad; R=$SP/rig
NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
ARM=$1; DB=$2; export CLI_ARM=${3:-pr}; TAG=$ARM-$DB
[ -f $R/run/model.pid ] && kill -0 $(cat $R/run/model.pid) 2>/dev/null || { nohup $NODE $R/model.mjs 15955 $R/run/model-requests.jsonl > $SP/logs/model.log 2>&1 & echo $! > $R/run/model.pid; }
touch $R/run/model-requests.jsonl
nohup $NODE $R/tap.mjs 16955 17955 $R/run/tap.jsonl > $SP/logs/tap.log 2>&1 & echo $! > $R/run/tap.pid
nohup $R/spring.sh $ARM $DB > $SP/logs/spring-$TAG.log 2>&1 & echo $! > $R/run/spring.pid
for i in $(seq 1 180); do grep -q "Started ManagedAgentServerApplication" $SP/logs/spring-$TAG.log && break; kill -0 $(cat $R/run/spring.pid) 2>/dev/null || { echo SPRING_DIED; exit 1; }; sleep 1; done
grep -o "Started ManagedAgentServerApplication in [0-9.]* seconds" $SP/logs/spring-$TAG.log
if [ "${NO_HARNESS:-}" != 1 ]; then
  nohup $R/harness.sh > $SP/logs/harness-$TAG.log 2>&1 & echo $! > $R/run/harness.pid
  for i in $(seq 1 90); do curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer rig-g0-token" http://127.0.0.1:16955/capabilities 2>/dev/null | grep -q 200 && break; sleep 1; done
  echo "harness via tap: $(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer rig-g0-token' http://127.0.0.1:16955/capabilities)"
fi
