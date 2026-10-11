#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682 R2): base battery on merge base 543f03e5 (m3), split out of r2.sh so the moved head ran first.
set -u
R=/root/v13682/rig; N=/usr/bin/node; L=$R/out/b3.log; : > $L
. $R/rig.env

M() { $MYSQL -h127.0.0.1 -P$DBPORT -uroot -p$DBPASS -N -B "$@" 2>/dev/null; }
[ "$(M -e 'SELECT 1')" = 1 ] || { echo "ABORT: rig MySQL on $DBPORT is not reachable" >> $L; exit 1; }
DBG="--logging.level.com.alibaba.qwen.code.managedagent.service.ActionResponseCoordinator=DEBUG --logging.level.com.alibaba.qwen.code.managedagent.service.SessionRenameCoordinator=DEBUG"
fresh() { bash $R/stop.sh $DB spring-c >> $L 2>&1; bash $R/stop.sh $DB all >> $L 2>&1; sleep 1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB $D 2>&1 | tail -1 >> $L
  SPRING_EXTRA="$DBG ${2:-}" ROLE=store bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L
  SPRING_EXTRA="$DBG ${2:-}" STORE=b APPROVAL=${1:-yolo} DIST=$D bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L; }
run() { echo "### [$DB $(date -u +%T)] $*" >> $L; (cd $R/probe && env DB=$DB RUNDIR=$R/run/$DB SPRING_C_URL=http://127.0.0.1:$SPRING_C_PORT "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
cleanw() { sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13682/rig/dist/\")==1 {print \$1}"); echo "leftover rig workers: $(echo $W | wc -w)" >> $L; [ -n "$W" ] && kill $W 2>/dev/null; }
stopall() { bash $R/stop.sh $DB spring-c >> $L 2>&1; bash $R/stop.sh $DB all >> $L 2>&1; cleanw; }
alog() { ls -t $R/run/$DB/spring-*.log | head -1; }
battery() {  # $1 = arm (h3|m3)
  JAR=$1; D=$1; DB=r2$1
  echo "## battery $1 $(date -u +%T) jar sha=$(sha256sum /root/v13682/server/$1-server.jar | cut -c1-16)" >> $L
  fresh yolo
  run $N p7-unicode.mjs ws-u a
  run $N p5-lost-reply.mjs turn ws-l5 b
  run $N p5-lost-reply.mjs empty ws-l5e c
  run $N p5-lost-reply.mjs unbound - -
  run $N p4-late-write.mjs bound ws-l4 d
  run $N p4-late-write.mjs unbound - -
  run $N p6-barrier.mjs ws-b6 e close
  run env HOLD=8000 $N p6-barrier.mjs ws-b6d f delete
  run env EMPTY=1 HOLD=6000 $N p6-barrier.mjs ws-b6e g close
  run $N c19-rename-race.mjs bound ws-c19 h
  run $N c21-boundary-moved.mjs bound ws-c21 a
  run $N p8-mixed.mjs ws-m b
  fresh default
  STARTA="SPRING_EXTRA='$DBG' STORE=b APPROVAL=default DIST=$D bash $R/spring.sh $JAR $DB"
  run env RESTART_CMD="bash $R/stop.sh $DB spring > /dev/null; $STARTA" $N p1-approval-cold.mjs ws-p1 a
  run env RESTART_CMD="bash $R/stop.sh $DB spring > /dev/null; $STARTA" $N c23-approve-retry.mjs ws-r1 b hold503 restore
  run env STOP_CMD="bash $R/stop.sh $DB spring" START_CMD="$STARTA" BLOG="$(ls -t $R/run/$DB/springb-*.log | head -1)" $N p2-disabled-replica.mjs ws-p2 c
  run $N c23-approve-retry.mjs ws-r3 d hold503 restore
  SPRING_EXTRA="$DBG" STORE=b APPROVAL=default DIST=$D bash $R/spring-c.sh $JAR $DB 2>&1 | tail -1 >> $L
  run $N p9-controls.mjs approve-peer ws-c1 e
  run $N p9-controls.mjs approve-peer ws-c2 f
  bash $R/stop.sh $DB spring-c >> $L 2>&1
  run env RESTART_CMD="bash $R/stop.sh $DB spring > /dev/null; $STARTA" $N p9-controls.mjs slow-term ws-s1 g
  run env KILL_CMD="bash $R/stop.sh $DB spring KILL > /dev/null; $STARTA" $N p9-controls.mjs approve-kill ws-k1 h
  stopall
  echo "## lease $1 (6 s lease, 2 s renew) with replica C" >> $L
  DB=r2o$1; LEASE="--qwen.managed-agent.dispatch.lease-duration=6s --qwen.managed-agent.dispatch.lease-renew-interval=2s"
  fresh default "$LEASE"; SPRING_EXTRA="$LEASE $DBG" STORE=b APPROVAL=default DIST=$D bash $R/spring-c.sh $JAR $DB 2>&1 | tail -1 >> $L
  run env HOLD=20000 $N p3-lease.mjs ws-l3 a
  for f in spring springb springc; do lf=$(ls -t $R/run/$DB/$f-*.log 2>/dev/null | head -1); echo "$f log: retry lines $(grep -c 'Action response will retry' $lf 2>/dev/null), renewal-failed $(grep -c 'lease renewal failed' $lf 2>/dev/null)" >> $L; done
  stopall
  echo "## battery $1 done $(date -u +%T)" >> $L
}
echo "B3-START $(date -u +%T)" >> $L
battery m3
echo "B3-DONE $(date -u +%T)" >> $L
