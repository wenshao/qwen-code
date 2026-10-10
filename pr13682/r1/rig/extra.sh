#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682): mixed-version arms and the Flyway upgrade paths, after both arms finished.
set -u
R=/root/v13682/rig; N=/usr/bin/node; L=$R/out/extra.log; : > $L
. $R/rig.env
M() { $MYSQL -h127.0.0.1 -P$DBPORT -uroot -p$DBPASS -N -B "$@" 2>/dev/null; }
until grep -q "ARM-DONE b" $R/out/arm-b.log 2>/dev/null; do sleep 20; done
echo "EXTRA-START $(date -u +%T)" >> $L
run() { local DB=$1; shift; echo "### [$DB $(date -u +%T)] $*" >> $L; (cd $R/probe && env DB=$DB "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
stack() { local DB=$1 JAR=$2 D=$3; bash $R/stop.sh $DB all >> $L 2>&1; sleep 1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB $D 2>&1 | tail -1 >> $L
  ROLE=store bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L; STORE=b APPROVAL=yolo DIST=$D bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L; }
cleanw() { sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13682/rig/dist/\")==1 {print \$1}"); echo "leftover rig workers: $(echo $W | wc -w)" >> $L; [ -n "$W" ] && kill $W 2>/dev/null; }
echo "## mx1: head server jar + base Harness/worker" >> $L
stack mx1 h b; run mx1 $N p8-mixed.mjs ws-mx1 a; bash $R/stop.sh mx1 all >> $L 2>&1; cleanw
echo "## mx2: base server jar + head Harness/worker" >> $L
stack mx2 b h; run mx2 $N p8-mixed.mjs ws-mx2 a; bash $R/stop.sh mx2 all >> $L 2>&1; cleanw
echo "## up62: base jar (main 2ebbd4e1, V62) then head jar on the same database" >> $L
stack up62 b b; run up62 $N p8-mixed.mjs ws-up a
echo "history before: $(M up62 -e 'SELECT GROUP_CONCAT(version ORDER BY installed_rank) FROM flyway_schema_history WHERE version IS NOT NULL')" >> $L
bash $R/stop.sh up62 spring >> $L 2>&1; bash $R/stop.sh up62 spring-b >> $L 2>&1
ROLE=store bash $R/spring.sh h up62 >> $L 2>&1; echo "head jar start rc=$?" >> $L
grep -E "Validate failed|Detected resolved migration|FlywayValidateException|outOfOrder|ignoreMigrationPatterns" $(ls -t $R/run/up62/springb-*.log | head -1) | head -6 | cut -c1-600 >> $L
echo "history after: $(M up62 -e 'SELECT GROUP_CONCAT(version ORDER BY installed_rank) FROM flyway_schema_history WHERE version IS NOT NULL')" >> $L
bash $R/stop.sh up62 all >> $L 2>&1; cleanw
echo "## up57: head jar limited to V57 (a main database before V60), then the full head jar" >> $L
bash $R/aux.sh up57 > /dev/null 2>&1; bash $R/harness.sh up57 h 2>&1 | tail -1 >> $L
SPRING_EXTRA="--spring.flyway.target=57" ROLE=store bash $R/spring.sh h up57 2>&1 | tail -2 >> $L
echo "history at target 57: $(M up57 -e 'SELECT GROUP_CONCAT(version ORDER BY installed_rank) FROM flyway_schema_history WHERE version IS NOT NULL' | tr ',' ' ' | awk '{print $1".."$NF" ("NF" rows)"}')" >> $L
bash $R/stop.sh up57 spring-b >> $L 2>&1
ROLE=store bash $R/spring.sh h up57 2>&1 | tail -1 >> $L; STORE=b APPROVAL=yolo DIST=h bash $R/spring.sh h up57 2>&1 | tail -1 >> $L
grep -E "Migrating schema|Successfully applied|Successfully validated" $(ls -t $R/run/up57/springb-*.log | head -1) | tail -5 | cut -c1-300 >> $L
echo "history after: $(M up57 -e 'SELECT GROUP_CONCAT(version ORDER BY installed_rank) FROM flyway_schema_history WHERE version IS NOT NULL' | tr ',' ' ' | awk '{print $(NF-3), $(NF-2), $(NF-1), $NF}')" >> $L
run up57 $N p8-mixed.mjs ws-up57 a
bash $R/stop.sh up57 all >> $L 2>&1; cleanw
echo "EXTRA-DONE $(date -u +%T)" >> $L
