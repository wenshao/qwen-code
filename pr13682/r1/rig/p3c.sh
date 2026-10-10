#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682): slow approval delivery past a 6 s lease with a second Harness-enabled replica C.
# Arms: head jar; head jar with renewal disabled (J3 control); base jar.
set -u
R=/root/v13682/rig; N=/usr/bin/node; L=$R/out/p3c.log; : > $L
true
echo "P3C-START $(date -u +%T)" >> $L
LEASE="--qwen.managed-agent.dispatch.lease-duration=6s --qwen.managed-agent.dispatch.lease-renew-interval=2s"
DBG="--logging.level.com.alibaba.qwen.code.managedagent.service.ActionResponseCoordinator=DEBUG"
for spec in h:h hJ3:h b:b; do JAR=${spec%%:*}; D=${spec##*:}; DB=o$JAR
  echo "## arm $JAR (dist $D)" >> $L
  bash $R/stop.sh $DB all >> $L 2>&1; sleep 1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB $D 2>&1 | tail -1 >> $L
  SPRING_EXTRA="$LEASE $DBG" ROLE=store bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L
  SPRING_EXTRA="$LEASE $DBG" STORE=b APPROVAL=default DIST=$D bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L
  SPRING_EXTRA="$LEASE $DBG" STORE=b APPROVAL=default DIST=$D bash $R/spring-c.sh $JAR $DB 2>&1 | tail -1 >> $L
  echo "### [$JAR $(date -u +%T)] p3-lease" >> $L
  (cd $R/probe && env DB=$DB HOLD=20000 $N p3-lease.mjs ws-l3 a >> $L 2>&1); echo "RC=$?" >> $L
  for f in spring springb springc; do lf=$(ls -t $R/run/$DB/$f-*.log 2>/dev/null | head -1); echo "$f log: retry lines $(grep -c 'Action response will retry' $lf 2>/dev/null), renewal-failed $(grep -c 'lease renewal failed' $lf 2>/dev/null)" >> $L; grep -m2 'Action response will retry' $lf 2>/dev/null | cut -c1-300 >> $L; done
  bash $R/stop.sh $DB spring-c >> $L 2>&1; bash $R/stop.sh $DB all >> $L 2>&1
  sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13682/rig/dist/\")==1 {print \$1}"); echo "leftover rig workers: $(echo $W | wc -w)" >> $L; [ -n "$W" ] && kill $W 2>/dev/null
done
echo "P3C-DONE $(date -u +%T)" >> $L
