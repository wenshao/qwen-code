#!/bin/bash
# Lane-aware start. usage: LANE=1|2 [DB=..] [ASYNC=1] up-l.sh <jarArm> <workerWT>
R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad/rig
ARM=$1; WTW=$2; shift 2
L=${LANE:-1}; export HTTP_PORT=$((18644+10*L)) BROKER_PORT=$((19644+10*L)) PUB_PORT=$((18645+10*L))
DB=${DB:-p654l$L}
cd $R && (JAR_ARM=$ARM WT=$WTW nohup ./spring-l.sh $DB "$@" > $R/run/spring-lane$L-$DB-$(date +%H%M%S).log 2>&1 & echo $! > $R/run/spring-lane$L.pid)
for i in $(seq 1 180); do curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$HTTP_PORT/actuator/health 2>/dev/null | grep -q 200 && break; kill -0 $(cat $R/run/spring-lane$L.pid) 2>/dev/null || { echo "spring died"; exit 1; }; sleep 1; done
echo "lane $L spring up pid=$(cat $R/run/spring-lane$L.pid) port=$HTTP_PORT arm=$ARM worker=$WTW db=$DB async=${ASYNC:-unset}"
