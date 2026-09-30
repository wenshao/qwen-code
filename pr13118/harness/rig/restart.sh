#!/bin/bash
# usage: restart.sh <label> [WORKER_ENTRY] [JAR_ARM]   stops my Spring (by pid file) and its workers, starts again
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/1123ef1a-b81b-4bc6-9042-45df0824fe93/scratchpad
LABEL=$1; ENTRY=$2; JAR=${3:-pr}
if [ -f $SP/logs/spring.pid ]; then kill $(cat $SP/logs/spring.pid) 2>/dev/null; fi
if [ -f $SP/logs/spring-pr.pid ]; then kill $(cat $SP/logs/spring-pr.pid) 2>/dev/null; rm -f $SP/logs/spring-pr.pid; fi
sleep 4
# workers of this rig only: node processes whose command names this session's scratchpad
for pid in $(ps -axo pid=,command= | awk -v sp="$SP" '$2 ~ /\/node$/ && index($0, sp) > 0 && index($0, "cli.js managed-runtime-worker") > 0 {print $1}'); do kill $pid 2>/dev/null; done
sleep 1
cd $SP/rig
if [ -n "$ENTRY" ]; then export WORKER_ENTRY=$ENTRY; fi
JAR_ARM=$JAR STORAGES="a b c d e f" nohup bash spring.sh p118a 18118 19118 17118 > $SP/logs/spring-$LABEL.out 2>&1 &
echo $! > $SP/logs/spring.pid
for i in $(seq 1 90); do
  curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18118/actuator/health 2>/dev/null | grep -q 200 && break
  grep -q "APPLICATION FAILED" $SP/logs/spring-$LABEL.out && break
  sleep 2
done
grep -E "Started Managed|APPLICATION FAILED" $SP/logs/spring-$LABEL.out | head -2
echo "label=$LABEL entry=${ENTRY:-default} jar=$JAR pid=$(cat $SP/logs/spring.pid)"
