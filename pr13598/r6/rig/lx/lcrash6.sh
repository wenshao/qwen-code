#!/bin/bash
# usage: lcrash6.sh <db> <label> [harness|cold]
#   harness: SIGKILL + restart the Harness only (Broker stays warm)
#   cold:    SIGKILL the Harness AND Spring (embedded Broker), list surviving runtime workers,
#            start Spring, wait for health, then start the Harness — the cold-Broker case.
# Waits for a NEW delayed execution poll (after this script started), then acts 8 s later.
cd /rig; DB=$1; LABEL=$2; MODE=${3:-cold}; L=runs/$DB/actions.log; T=runs/$DB/broker-tap.jsonl
n0=$(grep -c '"rule":"delay"' $T 2>/dev/null || true); n0=${n0:-0}
until [ "$(grep -c '"rule":"delay"' $T 2>/dev/null || echo 0)" -gt "$n0" ]; do sleep 0.5; done
echo "$(date -u +%T) delayed tool poll seen ($LABEL)" >> $L
sleep 8
SP=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("runs/'$DB'/state.json")).springPort)')
if [ "$MODE" = cold ]; then
  SPID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("runs/'$DB'/state.json")).pids.spring)')
  echo "$(date -u +%T) SIGKILL Harness (group) and the Spring JVM pid $SPID only - durable workers share its process group and must survive ($LABEL)" >> $L
  node lstack6.mjs stop $DB harness >> $L 2>&1
  kill -9 $SPID
  node -e 'const f="runs/'$DB'/state.json";const s=JSON.parse(require("fs").readFileSync(f));delete s.pids.spring;require("fs").writeFileSync(f,JSON.stringify(s,null,2))'
  sleep 1
  echo "$(date -u +%T) runtime workers still alive: $(pgrep -f 'cli.js managed-runtime-worker' | tr '\n' ' ')" >> $L
  ps -eo pid,pgid,etimes,args | grep -E "cli.js|java" | grep -v grep | cut -c1-160 >> $L
  node lstack6.mjs spring $DB >> $L 2>&1
  for i in $(seq 120); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$SP/actuator/health 2>/dev/null | grep -q 200 && break; sleep 1; done
  echo "$(date -u +%T) Spring healthy again" >> $L
  node lstack6.mjs harness $DB >> $L 2>&1
else
  echo "$(date -u +%T) SIGKILL + restart Harness ($LABEL)" >> $L
  node lstack6.mjs harness $DB >> $L 2>&1
fi
echo "$(date -u +%T) restarted" >> $L
