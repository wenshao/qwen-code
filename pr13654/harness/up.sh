#!/bin/bash
# usage: [DB=..] [ASYNC=1] up.sh <jarArm> <workerWT> [extra spring args]
R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad/rig
ARM=$1; WTW=$2; shift 2
DB=${DB:-p654a}
cd $R && (JAR_ARM=$ARM WT=$WTW nohup ./spring.sh $DB "$@" > $R/run/spring-$DB-$(date +%H%M%S).log 2>&1 & echo $! > $R/run/spring.pid)
for i in $(seq 1 150); do curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18654/actuator/health 2>/dev/null | grep -q 200 && break; kill -0 $(cat $R/run/spring.pid) 2>/dev/null || { echo "spring died"; exit 1; }; sleep 1; done
echo "spring up pid=$(cat $R/run/spring.pid) arm=$ARM worker=$WTW db=$DB async=${ASYNC:-unset}: $(curl -s http://127.0.0.1:18654/actuator/health)"
