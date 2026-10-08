#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R9): WebShell cancel screenshots on head 39267a90 (en revoke, zh draining) and base d735e20f (en revoke).
R=/root/v13163/rig; N=/usr/bin/node; L=$R/out/r9/ui9.log; : > $L
until grep -q SEQ9-DONE $R/out/r9/seq9.log; do sleep 20; done
echo "UI9-START $(date -u +%T)" >> $L
for A in h9 b9; do DB=u$A
  run() { echo "### [$A $(date -u +%T)] $*" >> $L; (cd $R/probe && env DB=$DB ARM=$A "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
  bash $R/aux.sh $DB >> $L 2>&1; bash $R/harness.sh $DB $A >> $L 2>&1
  ROLE=store bash $R/spring.sh $A $DB >> $L 2>&1; STORE=b DIST=$A bash $R/spring.sh $A $DB >> $L 2>&1
  bash $R/vite.sh $A >> $L 2>&1
  run $N c13-ui-cancel.mjs ws-u1-$A b revoke en
  [ $A = h9 ] && run $N c13-ui-cancel.mjs ws-u2-$A c draining zh
  [ $A = h9 ] && run $N c13-ui-cancel.mjs ws-u3-$A d reader en
  kill $(cat $R/run/vite-$A.pid) 2>/dev/null
  bash $R/stop.sh $DB all >> $L 2>&1
done
sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13163/rig/dist/\")==1 {print \$1}"); echo "leftover rig workers: $(echo $W | wc -w)" >> $L; [ -n "$W" ] && kill $W 2>/dev/null
echo "UI9-DONE $(date -u +%T)" >> $L
