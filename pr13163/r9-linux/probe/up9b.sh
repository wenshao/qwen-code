#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R9): post-upgrade smoke on storages the base arm never used (d, h).
R=/root/v13163/rig; N=/usr/bin/node; DB=b9; L=$R/out/r9/up9b.log; : > $L
until grep -q EXTRA9-DONE $R/out/r9/extra9.log 2>/dev/null; do sleep 20; done
run() { echo "### [up9b $(date -u +%T)] $*" >> $L; (cd $R/probe && env DB=$DB "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
bash $R/stop.sh $DB all >> $L 2>&1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB h9 2>&1 | tail -1 >> $L
ROLE=store bash $R/spring.sh h9 $DB 2>&1 | tail -1 >> $L; STORE=b DIST=h9 bash $R/spring.sh h9 $DB 2>&1 | tail -1 >> $L
run $N c1-cancel-refused.mjs ws-up-d d revoke alice
run $N c19-rename-race.mjs bound ws-up-h h
run $N c21-boundary-moved.mjs bound ws-up-h2 h
bash $R/stop.sh $DB all >> $L 2>&1
sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13163/rig/dist/\")==1 {print \$1}"); echo "leftover rig workers: $(echo $W | wc -w)" >> $L; [ -n "$W" ] && kill $W 2>/dev/null
echo "UP9B-DONE $(date -u +%T)" >> $L
