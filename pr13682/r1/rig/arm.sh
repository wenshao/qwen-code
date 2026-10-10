#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682): one arm on the real stack (Linux, durable local process, Session Store on replica B).
#   usage: arm.sh <h|b>
set -u
R=/root/v13682/rig; N=/usr/bin/node; ARM=$1
case $ARM in h) DB=h; JAR=h; D=h;; b) DB=b; JAR=b; D=b;; esac
L=$R/out/arm-$ARM.log; mkdir -p $(dirname $L); : > $L
BDEBUG="--logging.level.com.alibaba.qwen.code.managedagent.service.ActionResponseCoordinator=DEBUG --logging.level.com.alibaba.qwen.code.managedagent.service.SessionRenameCoordinator=DEBUG"
fresh() { bash $R/stop.sh $DB all >> $L 2>&1; sleep 1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB $D 2>&1 | tail -1 >> $L
  SPRING_EXTRA="$BDEBUG" ROLE=store bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L; STORE=b APPROVAL=${1:-yolo} DIST=$D bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L; }
run() { echo "### [$ARM $(date -u +%T)] $*" >> $L; (cd $R/probe && env DB=$DB "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
STARTA="STORE=b APPROVAL=default DIST=$D bash $R/spring.sh $JAR $DB"
COLD="bash $R/stop.sh $DB spring > /dev/null; $STARTA"
echo "ARM-START $ARM db=$DB jar=$JAR dist=$D $(date -u +%T)" >> $L
fresh yolo
run $N p7-unicode.mjs ws-u a
run $N p5-lost-reply.mjs turn ws-l5 b
run $N p5-lost-reply.mjs empty ws-l5e c
run $N p5-lost-reply.mjs unbound - -
run $N p4-late-write.mjs bound ws-l4 d
run $N p4-late-write.mjs unbound - -
run $N p6-barrier.mjs ws-b6 e close
run env HOLD=8000 $N p6-barrier.mjs ws-b6d f delete
run $N c19-rename-race.mjs bound ws-c19 g
run $N c21-boundary-moved.mjs bound ws-c21 h
run $N p8-mixed.mjs ws-m a
fresh default
run env RESTART_CMD="$COLD" $N p1-approval-cold.mjs ws-p1 a
run env RESTART_CMD="$COLD" $N c23-approve-retry.mjs ws-r1 b hold503 restore
run env STOP_CMD="bash $R/stop.sh $DB spring" START_CMD="$STARTA" BLOG="$(ls -t $R/run/$DB/springb-*.log | head -1)" $N p2-disabled-replica.mjs ws-p2 c
run $N c23-approve-retry.mjs ws-r3 d hold503 restore
run $N c23-approve-retry.mjs ws-r4 e hold503 restore
bash $R/stop.sh $DB all >> $L 2>&1
sleep 2
W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13682/rig/dist/\")==1 {print \$1}"); echo "leftover rig workers: $(echo $W | wc -w)" >> $L; [ -n "$W" ] && kill $W 2>/dev/null
echo "ARM-DONE $ARM $(date -u +%T)" >> $L
