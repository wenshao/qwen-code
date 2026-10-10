#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682): restart/peer controls per arm (see probe/p9-controls.mjs).
set -u
R=/root/v13682/rig; N=/usr/bin/node; L=$R/out/p9.log; : > $L
. $R/rig.env
until grep -q "UI-DONE" $R/out/ui.log 2>/dev/null; do sleep 20; done
echo "P9-START $(date -u +%T)" >> $L
for A in h b; do DB=k$A
  bash $R/stop.sh $DB all >> $L 2>&1; sleep 1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB $A 2>&1 | tail -1 >> $L
  ROLE=store bash $R/spring.sh $A $DB 2>&1 | tail -1 >> $L; STORE=b APPROVAL=default DIST=$A bash $R/spring.sh $A $DB 2>&1 | tail -1 >> $L
  STARTA="STORE=b APPROVAL=default DIST=$A bash $R/spring.sh $A $DB"
  run() { echo "### [$A $(date -u +%T)] $*" >> $L; (cd $R/probe && env DB=$DB RUNDIR=$R/run/$DB SPRING_C_URL=http://127.0.0.1:$SPRING_C_PORT "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
  run env RESTART_CMD="bash $R/stop.sh $DB spring > /dev/null; $STARTA" $N p9-controls.mjs slow-term ws-s1 a
  run env KILL_CMD="bash $R/stop.sh $DB spring KILL > /dev/null; $STARTA" $N p9-controls.mjs approve-kill ws-k1 b
  STORE=b APPROVAL=default DIST=$A bash $R/spring-c.sh $A $DB 2>&1 | tail -1 >> $L
  run $N p9-controls.mjs approve-peer ws-c1 c
  run $N p9-controls.mjs approve-peer ws-c2 d
  bash $R/stop.sh $DB spring-c >> $L 2>&1; bash $R/stop.sh $DB all >> $L 2>&1
  sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13682/rig/dist/\")==1 {print \$1}"); echo "leftover rig workers: $(echo $W | wc -w)" >> $L; [ -n "$W" ] && kill $W 2>/dev/null
done
echo "P9-DONE $(date -u +%T)" >> $L
