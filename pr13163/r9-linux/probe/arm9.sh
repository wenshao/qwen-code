#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R9): one arm on the real stack (Linux, durable local process, Session Store on replica B).
#   usage: arm9.sh <h9|x9|b9|up9>
set -u
R=/root/v13163/rig; N=/usr/bin/node; ARM=$1
case $ARM in h9) DB=h9; JAR=h9; D=h9;; x9) DB=x9; JAR=x9; D=h9;; b9) DB=b9; JAR=b9; D=b9;; up9) DB=b9; JAR=h9; D=h9;; esac
L=$R/out/r9/arm-$ARM.log; mkdir -p $(dirname $L); : > $L
fresh() { bash $R/stop.sh $DB all >> $L 2>&1; sleep 1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB $D 2>&1 | tail -1 >> $L
  ROLE=store bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L; STORE=b APPROVAL=${1:-yolo} DIST=$D bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L; }
restartA() { bash $R/stop.sh $DB spring >> $L 2>&1; STORE=b APPROVAL=${1:-yolo} DIST=$D bash $R/spring.sh $JAR $DB 2>&1 | tail -1; }
run() { echo "### [$ARM $(date -u +%T)] $*" >> $L; (cd $R/probe && env DB=$DB "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
c14() { run $N c14-cold-cache.mjs start ws-k$1-$ARM $2 $1; restartA >> $L; run $N c14-cold-cache.mjs cancel ws-k$1-$ARM $2 $1
  echo "latch lines: $(grep -c "session log writes stopped" $(ls -t $R/run/$DB/harness-*.log | head -1))" >> $L; }
COLD="bash $R/stop.sh $DB spring > /dev/null; STORE=b APPROVAL=default DIST=$D bash $R/spring.sh $JAR $DB"
c23() { run $N c23-approve-retry.mjs "$@"; }
echo "ARM9-START $ARM db=$DB jar=$JAR dist=$D $(date -u +%T)" >> $L
if [ $ARM = up9 ]; then
  echo "### upgrade: head jar on the base arm database" >> $L
  /opt/mysql-8/bin/mysql -h127.0.0.1 -P18169 -uroot -p$DBPASS -N -e "SELECT version, success FROM b9.flyway_schema_history ORDER BY installed_rank DESC LIMIT 2" 2>/dev/null >> $L
  fresh yolo
  /opt/mysql-8/bin/mysql -h127.0.0.1 -P18169 -uroot -p$DBPASS -N -e "SELECT version, description, success, execution_time FROM b9.flyway_schema_history ORDER BY installed_rank DESC LIMIT 3" 2>/dev/null >> $L
  grep -E "Migrating schema|Successfully applied|Successfully validated" $(ls -t $R/run/$DB/spring-*.log | head -1) | tail -4 >> $L
  run $N c19-rename-race.mjs bound ws-up-c19 e
  run $N c1-cancel-refused.mjs ws-up-a a revoke alice
fi
if [ $ARM = h9 ]; then
  fresh yolo
  run $N c1-cancel-refused.mjs ws-a a revoke alice
  run $N c1-cancel-refused.mjs ws-b b draining alice
  run $N c1-cancel-refused.mjs ws-c c regen alice
  run env RESTORE=early $N c1-cancel-refused.mjs ws-ea a revoke alice
  run env RESTORE=early $N c1-cancel-refused.mjs ws-eb b draining alice
  run $N c1-cancel-refused.mjs ws-d d storage alice
  run $N c1-cancel-refused.mjs ws-e e unread alice
  run $N c1-cancel-refused.mjs ws-f f control alice
  run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g control bob
  run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g control carol
  run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g control mallory
  run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g revoke bob
  run $N c5-regen-admission.mjs ws-c5a a regen
  run $N c5-regen-admission.mjs ws-c5b b storage
  run $N c7-replay-order.mjs ws-c7 c
  for f in respond400 respond404 respond500 drop-before; do run $N c8-rename-refused.mjs bound ws-c8 d $f; done
  for f in respond400 respond500; do run $N c8-rename-refused.mjs unbound - - $f; done
  run $N c3-lost-delivery.mjs bound ws-c3 e drop-before 1
  run $N c3-lost-delivery.mjs unbound - - drop-before 1
  run $N c16-page-caps.mjs ws-p1 b ws-p0 c regen
  run $N f4b-sql-state.mjs ws-f4b d
  for k in bound unbound; do run $N c19-rename-race.mjs $k ws-c19-$k e; run $N c21-boundary-moved.mjs $k ws-c21-$k e; done
fi
if [ $ARM = b9 ]; then
  fresh yolo
  run $N c1-cancel-refused.mjs ws-a a revoke alice
  run $N c1-cancel-refused.mjs ws-b b draining alice
  run $N c1-cancel-refused.mjs ws-c c regen alice
fi
if [ $ARM = h9 ] || [ $ARM = b9 ]; then fresh yolo; c14 revoke a; fresh yolo; c14 none g; fi
if [ $ARM != up9 ]; then
  fresh default
  run $N c22-approve-refused.mjs ws-c22 f
  c23 ws-r1 a revoke restore
  c23 ws-r2 b revoke cancel
  c23 ws-r3 c draining restore
  c23 ws-r5 e regen restore
  if [ $ARM = h9 ]; then c23 ws-r4 d unread restore; c23 ws-r6 g storage restore; c23 ws-r8 b draining cancel; fi
  run env RESTART_CMD="$COLD" $N c23-approve-retry.mjs ws-r7 f revoke restore
fi
bash $R/stop.sh $DB all >> $L 2>&1
sleep 2
W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13163/rig/dist/\")==1 {print \$1}"); echo "leftover rig workers: $(echo $W | wc -w)" >> $L; [ -n "$W" ] && kill $W 2>/dev/null
echo "ARM9-DONE $ARM $(date -u +%T)" >> $L
