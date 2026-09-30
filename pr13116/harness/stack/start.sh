#!/bin/bash
# VERIFICATION RIG ONLY. usage: start.sh <jar label> <db> [what...]  (default: model tap spring harness)
S=/Users/wenshao/pr13116-rig/stack; NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
L=$1; DB=$2; shift 2; WHAT="${*:-model tap spring harness}"
for w in $WHAT; do case $w in
  model) touch $S/run/model-requests.jsonl; nohup $NODE $S/model.mjs 15116 $S/run/model-requests.jsonl > $S/logs/model.log 2>&1 & echo $! > $S/run/model.pid;;
  tap) nohup $NODE $S/tap.mjs 16116 17116 $S/run/tap.jsonl > $S/logs/tap.log 2>&1 & echo $! > $S/run/tap.pid;;
  spring) echo "=== start $L $DB $(date -u +%FT%TZ)" >> $S/logs/spring-$DB.log
    nohup $S/spring.sh $L $DB ${SPRING_EXTRA:-} >> $S/logs/spring-$DB.log 2>&1 & echo $! > $S/run/spring.pid
    for i in $(seq 1 300); do tail -400 $S/logs/spring-$DB.log | /usr/bin/grep -q "Started ManagedAgentServerApplication" && break; kill -0 $(cat $S/run/spring.pid) 2>/dev/null || { echo SPRING_DIED; break; }; sleep 1; done
    /usr/bin/grep -o "Started ManagedAgentServerApplication in [0-9.]* seconds" $S/logs/spring-$DB.log | tail -1;;
  harness) nohup $S/harness.sh >> $S/logs/harness-$DB.log 2>&1 & echo $! > $S/run/harness.pid
    for i in $(seq 1 180); do curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer rig-13116-token" http://127.0.0.1:16116/capabilities 2>/dev/null | /usr/bin/grep -q 200 && break; sleep 1; done
    echo "harness via tap: $(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer rig-13116-token' http://127.0.0.1:16116/capabilities)";;
esac; done
