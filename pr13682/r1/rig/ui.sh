#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682): real WebShell panel answering an approval after a dispatcher restart, per arm.
set -u
R=/root/v13682/rig; N=/usr/bin/node; L=$R/out/ui.log; : > $L
until grep -q "P3-DONE" $R/out/p3.log 2>/dev/null; do sleep 20; done
echo "UI-START $(date -u +%T)" >> $L
for A in h b; do DB=ui$A
  bash $R/stop.sh $DB all >> $L 2>&1; sleep 1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB $A 2>&1 | tail -1 >> $L
  ROLE=store bash $R/spring.sh $A $DB 2>&1 | tail -1 >> $L; STORE=b APPROVAL=default DIST=$A bash $R/spring.sh $A $DB 2>&1 | tail -1 >> $L
  bash $R/vite.sh $A >> $L 2>&1
  COLD="bash $R/stop.sh $DB spring > /dev/null; STORE=b APPROVAL=default DIST=$A bash $R/spring.sh $A $DB"
  echo "### [$A $(date -u +%T)] p1-ui" >> $L
  (cd $R/probe && env DB=$DB ARM=$A RESTART_CMD="$COLD" $N p1-ui.mjs ws-ui-$A a >> $L 2>&1); echo "RC=$?" >> $L
  kill $(cat $R/run/vite-$A.pid) 2>/dev/null
  bash $R/stop.sh $DB all >> $L 2>&1
  sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13682/rig/dist/\")==1 {print \$1}"); echo "leftover rig workers: $(echo $W | wc -w)" >> $L; [ -n "$W" ] && kill $W 2>/dev/null
done
echo "UI-DONE $(date -u +%T)" >> $L
