#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R9): refused-authority cancel racing Session delete/close, head vs base.
R=/root/v13163/rig; N=/usr/bin/node; L=$R/out/r9/extra9.log; : > $L
until grep -q UI9-DONE $R/out/r9/ui9.log 2>/dev/null; do sleep 20; done
echo "EXTRA9-START $(date -u +%T)" >> $L
for A in h9 b9; do DB=e$A
  run() { echo "### [$A $(date -u +%T)] $*" >> $L; (cd $R/probe && env DB=$DB "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
  bash $R/stop.sh $DB all >> $L 2>&1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB $A 2>&1 | tail -1 >> $L
  ROLE=store bash $R/spring.sh $A $DB 2>&1 | tail -1 >> $L; STORE=b DIST=$A bash $R/spring.sh $A $DB 2>&1 | tail -1 >> $L
  run $N c24-cancel-delete.mjs ws-d1 a delete 300
  run $N c24-cancel-delete.mjs ws-d2 b close 300
  run $N c24-cancel-delete.mjs ws-d3 c delete 0
  bash $R/stop.sh $DB all >> $L 2>&1
done
sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13163/rig/dist/\")==1 {print \$1}"); echo "leftover rig workers: $(echo $W | wc -w)" >> $L; [ -n "$W" ] && kill $W 2>/dev/null
echo "EXTRA9-DONE $(date -u +%T)" >> $L
