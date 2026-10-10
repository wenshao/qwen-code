#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682): re-run the key probes on the moved head 6c66366a (h2) and the upgrade from main 9763580b (m2, V64).
set -u
R=/root/v13682/rig; N=/usr/bin/node; L=$R/out/arm-h2.log; : > $L
. $R/rig.env
until grep -q "ALL-DONE" /root/v13682/out/main2.log 2>/dev/null && grep -q "P3C-DONE" $R/out/p3c.log 2>/dev/null; do sleep 20; done
M() { $MYSQL -h127.0.0.1 -P$DBPORT -uroot -p$DBPASS -N -B "$@" 2>/dev/null; }
DB=h2; JAR=h2; D=h2
BDEBUG="--logging.level.com.alibaba.qwen.code.managedagent.service.ActionResponseCoordinator=DEBUG"
fresh() { bash $R/stop.sh $DB spring-c >> $L 2>&1; bash $R/stop.sh $DB all >> $L 2>&1; sleep 1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB $D 2>&1 | tail -1 >> $L
  SPRING_EXTRA="$BDEBUG ${2:-}" ROLE=store bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L; SPRING_EXTRA="${2:-}" STORE=b APPROVAL=${1:-yolo} DIST=$D bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L; }
run() { echo "### [$DB $(date -u +%T)] $*" >> $L; (cd $R/probe && env DB=$DB RUNDIR=$R/run/$DB SPRING_C_URL=http://127.0.0.1:$SPRING_C_PORT "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
cleanw() { sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13682/rig/dist/\")==1 {print \$1}"); echo "leftover rig workers: $(echo $W | wc -w)" >> $L; [ -n "$W" ] && kill $W 2>/dev/null; }
echo "ARM2-START $(date -u +%T) jar sha=$(sha256sum /root/v13682/server/h2-server.jar | cut -c1-16) migrations=$(unzip -l /root/v13682/server/h2-server.jar | grep -o 'db/migration/V[0-9]*__' | sed 's#db/migration/##' | sort -V | uniq | tail -5 | tr '\n' ' ')" >> $L
fresh yolo
run $N p7-unicode.mjs ws-u a
run $N p5-lost-reply.mjs turn ws-l5 b
run $N p5-lost-reply.mjs unbound - -
run $N p4-late-write.mjs bound ws-l4 c
run $N p6-barrier.mjs ws-b6 d close
run env EMPTY=1 HOLD=6000 $N p6-barrier.mjs ws-b6e e close
run $N c21-boundary-moved.mjs bound ws-c21 f
fresh default
STARTA="STORE=b APPROVAL=default DIST=$D bash $R/spring.sh $JAR $DB"
run $N c23-approve-retry.mjs ws-r3 a hold503 restore
run env STOP_CMD="bash $R/stop.sh $DB spring" START_CMD="$STARTA" BLOG="$(ls -t $R/run/$DB/springb-*.log | head -1)" $N p2-disabled-replica.mjs ws-p2 b
STORE=b APPROVAL=default DIST=$D bash $R/spring-c.sh $JAR $DB 2>&1 | tail -1 >> $L
run $N p9-controls.mjs approve-peer ws-c1 c
run $N p9-controls.mjs approve-peer ws-c2 d
bash $R/stop.sh $DB spring-c >> $L 2>&1
run env RESTART_CMD="bash $R/stop.sh $DB spring > /dev/null; $STARTA" $N p1-approval-cold.mjs ws-p1 e
bash $R/stop.sh $DB all >> $L 2>&1; cleanw
echo "## lease (6 s lease, 2 s renew) with replica C" >> $L
DB=oh2; LEASE="--qwen.managed-agent.dispatch.lease-duration=6s --qwen.managed-agent.dispatch.lease-renew-interval=2s"
fresh default "$LEASE"; SPRING_EXTRA="$LEASE" STORE=b APPROVAL=default DIST=$D bash $R/spring-c.sh $JAR $DB 2>&1 | tail -1 >> $L
run env HOLD=20000 $N p3-lease.mjs ws-l3 a
bash $R/stop.sh $DB spring-c >> $L 2>&1; bash $R/stop.sh $DB all >> $L 2>&1; cleanw
echo "## up64: main 9763580b jar (V64) then the moved head jar on the same database" >> $L
DB=up64; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB b 2>&1 | tail -1 >> $L
ROLE=store bash $R/spring.sh m2 $DB 2>&1 | tail -1 >> $L
echo "history before: $(M $DB -e 'SELECT GROUP_CONCAT(version ORDER BY installed_rank) FROM flyway_schema_history WHERE version IS NOT NULL' | tr ',' ' ' | awk '{print $(NF-5), $(NF-4), $(NF-3), $(NF-2), $(NF-1), $NF}')" >> $L
bash $R/stop.sh $DB spring-b >> $L 2>&1
ROLE=store bash $R/spring.sh h2 $DB >> $L 2>&1; echo "moved-head jar start rc=$?" >> $L
grep -E "Detected resolved migration|To ignore this migration|FlywayValidateException" $(ls -t $R/run/$DB/springb-*.log | head -1) | sort -u | head -3 | cut -c1-300 >> $L
bash $R/stop.sh $DB all >> $L 2>&1; cleanw
echo "## up57b: moved head limited to V57, then full" >> $L
DB=up57b; bash $R/aux.sh $DB > /dev/null 2>&1
SPRING_EXTRA="--spring.flyway.target=57" ROLE=store bash $R/spring.sh h2 $DB 2>&1 | tail -1 >> $L; bash $R/stop.sh $DB spring-b >> $L 2>&1
ROLE=store bash $R/spring.sh h2 $DB 2>&1 | tail -1 >> $L
grep -E "Migrating schema|Successfully applied" $(ls -t $R/run/$DB/springb-*.log | head -1) | tail -5 | cut -c1-200 >> $L
bash $R/stop.sh $DB all >> $L 2>&1; cleanw
echo "ARM2-DONE $(date -u +%T)" >> $L
