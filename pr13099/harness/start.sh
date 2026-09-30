#!/bin/bash
# VERIFICATION RIG ONLY. usage: start.sh <db> [what...]  (default: model tap spring harness)
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad; R=$SP/rig; NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
DB=$1; shift; WHAT="${*:-model tap spring harness}"
for w in $WHAT; do case $w in
  model) touch $R/run/model-requests.jsonl; nohup $NODE $R/model.mjs 15099 $R/run/model-requests.jsonl > $SP/logs/model.log 2>&1 & echo $! > $R/run/model.pid;;
  tap) nohup $NODE $R/tap.mjs 16099 17099 $R/run/tap.jsonl > $SP/logs/tap.log 2>&1 & echo $! > $R/run/tap.pid;;
  spring) nohup $R/spring.sh $DB >> $SP/logs/spring-$DB.log 2>&1 & echo $! > $R/run/spring.pid
    for i in $(seq 1 240); do grep -q "Started ManagedAgentServerApplication" $SP/logs/spring-$DB.log && break; kill -0 $(cat $R/run/spring.pid) 2>/dev/null || { echo SPRING_DIED; tail -30 $SP/logs/spring-$DB.log; exit 1; }; sleep 1; done
    grep -o "Started ManagedAgentServerApplication in [0-9.]* seconds" $SP/logs/spring-$DB.log | tail -1;;
  harness) nohup $R/harness.sh >> $SP/logs/harness-$DB.log 2>&1 & echo $! > $R/run/harness.pid
    for i in $(seq 1 120); do curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer rig-13099-token" http://127.0.0.1:16099/capabilities 2>/dev/null | grep -q 200 && break; sleep 1; done
    echo "harness via tap: $(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer rig-13099-token' http://127.0.0.1:16099/capabilities)";;
esac; done
