#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682 R2): re-run the key cells on the moved head ab1af693 (h4 = main d35277c2 + PR, V67),
# and upgrade a database migrated by main d35277c2 (its own V66) to h4.
set -u
R=/root/v13682/rig; N=/usr/bin/node; L=$R/out/arm4.log; : > $L
. $R/rig.env
until grep -q "ALL5-DONE" /root/v13682/out/main5.log 2>/dev/null; do sleep 20; done
M() { $MYSQL -h127.0.0.1 -P$DBPORT -uroot -p$DBPASS -N -B "$@" 2>/dev/null; }
[ "$(M -e 'SELECT 1')" = 1 ] || { echo "ABORT: rig MySQL on $DBPORT is not reachable" >> $L; exit 1; }
DBG="--logging.level.com.alibaba.qwen.code.managedagent.service.ActionResponseCoordinator=DEBUG --logging.level.com.alibaba.qwen.code.managedagent.service.SessionRenameCoordinator=DEBUG"
JAR=h4; D=h4; DB=r2h4
fresh() { bash $R/stop.sh $DB spring-c >> $L 2>&1; bash $R/stop.sh $DB all >> $L 2>&1; sleep 1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB $D 2>&1 | tail -1 >> $L
  SPRING_EXTRA="$DBG ${2:-}" ROLE=store bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L
  SPRING_EXTRA="$DBG ${2:-}" STORE=b APPROVAL=${1:-yolo} DIST=$D bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L; }
run() { echo "### [$DB $(date -u +%T)] $*" >> $L; (cd $R/probe && env DB=$DB RUNDIR=$R/run/$DB SPRING_C_URL=http://127.0.0.1:$SPRING_C_PORT "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
cleanw() { sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13682/rig/dist/\")==1 {print \$1}"); echo "leftover rig workers: $(echo $W | wc -w)" >> $L; [ -n "$W" ] && kill $W 2>/dev/null; }
stopall() { bash $R/stop.sh $DB spring-c >> $L 2>&1; bash $R/stop.sh $DB all >> $L 2>&1; cleanw; }
echo "ARM4-START $(date -u +%T) jar sha=$(sha256sum /root/v13682/server/h4-server.jar | cut -c1-16) migrations=$(unzip -l /root/v13682/server/h4-server.jar | grep -o 'db/migration/V6[0-9]__[a-z_]*' | sed 's#db/migration/##' | sort -V | tr '\n' ' ')" >> $L
fresh yolo
run $N p7-unicode.mjs ws-u a
run $N p5-lost-reply.mjs turn ws-l5 b
run $N p5-lost-reply.mjs empty ws-l5e c
run $N p5-lost-reply.mjs unbound - -
run $N p4-late-write.mjs bound ws-l4 d
run $N p6-barrier.mjs ws-b6 e close
run env EMPTY=1 HOLD=6000 $N p6-barrier.mjs ws-b6e g close
run $N c19-rename-race.mjs bound ws-c19 h
run $N c21-boundary-moved.mjs bound ws-c21 a
run $N p8-mixed.mjs ws-m b
fresh default
STARTA="SPRING_EXTRA='$DBG' STORE=b APPROVAL=default DIST=$D bash $R/spring.sh $JAR $DB"
run $N c23-approve-retry.mjs ws-r3 d hold503 restore
run env STOP_CMD="bash $R/stop.sh $DB spring" START_CMD="$STARTA" BLOG="$(ls -t $R/run/$DB/springb-*.log | head -1)" $N p2-disabled-replica.mjs ws-p2 c
SPRING_EXTRA="$DBG" STORE=b APPROVAL=default DIST=$D bash $R/spring-c.sh $JAR $DB 2>&1 | tail -1 >> $L
run $N p9-controls.mjs approve-peer ws-c1 e
run $N p9-controls.mjs approve-peer ws-c2 f
bash $R/stop.sh $DB spring-c >> $L 2>&1
run env RESTART_CMD="bash $R/stop.sh $DB spring > /dev/null; $STARTA" $N p1-approval-cold.mjs ws-p1 a
stopall
echo "## lease h4 (6 s lease, 2 s renew) with replica C" >> $L
DB=r2oh4; LEASE="--qwen.managed-agent.dispatch.lease-duration=6s --qwen.managed-agent.dispatch.lease-renew-interval=2s"
fresh default "$LEASE"; SPRING_EXTRA="$LEASE $DBG" STORE=b APPROVAL=default DIST=$D bash $R/spring-c.sh $JAR $DB 2>&1 | tail -1 >> $L
run env HOLD=20000 $N p3-lease.mjs ws-l3 a
stopall
echo "## upgrade r2upm4: main d35277c2 jar (V66 agent definition digest) with data, then h4 (V67)" >> $L
DB=r2upm4; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB h4 2>&1 | tail -1 >> $L
ROLE=store bash $R/spring.sh m4 $DB 2>&1 | tail -1 >> $L; STORE=b APPROVAL=yolo DIST=h4 bash $R/spring.sh m4 $DB 2>&1 | tail -1 >> $L
run $N p8-mixed.mjs ws-up a
run $N p5-lost-reply.mjs turn ws-up a
echo "history before: $(M $DB -e 'SELECT GROUP_CONCAT(CONCAT(version, ":", SUBSTRING_INDEX(description, " ", -2)) ORDER BY installed_rank SEPARATOR " | ") FROM flyway_schema_history WHERE version IS NOT NULL AND CAST(version AS UNSIGNED) >= 64')" >> $L
bash $R/stop.sh $DB all >> $L 2>&1; cleanw
bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB h4 2>&1 | tail -1 >> $L
ROLE=store bash $R/spring.sh h4 $DB >> $L 2>&1; urc=$?; echo "head jar start rc=$urc" >> $L
grep -E "Migrating schema|Successfully applied|Detected|FlywayValidateException|mismatch|more than one" $(ls -t $R/run/$DB/springb-*.log | head -1) | sort -u | head -4 | cut -c1-260 >> $L
echo "history after: $(M $DB -e 'SELECT GROUP_CONCAT(CONCAT(version, ":", SUBSTRING_INDEX(description, " ", -2), IF(success, "", "!")) ORDER BY installed_rank SEPARATOR " | ") FROM flyway_schema_history WHERE version IS NOT NULL AND CAST(version AS UNSIGNED) >= 64')" >> $L
if [ $urc = 0 ]; then SPRING_EXTRA="$DBG" STORE=b APPROVAL=yolo DIST=h4 bash $R/spring.sh h4 $DB 2>&1 | tail -1 >> $L
  run env ALOG="$(ls -t $R/run/$DB/spring-*.log | head -1)" $N p12-upgraded-old.mjs ws-up
  run $N p5-lost-reply.mjs turn ws-up2 b; fi
bash $R/stop.sh $DB all >> $L 2>&1; cleanw
echo "ARM4-DONE $(date -u +%T)" >> $L
