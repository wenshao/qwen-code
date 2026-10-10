#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682): real-stack replay of the unit-test survivors J14 (recovery worker never completes
# the receipt) and J11 (cwd ignores an open delivery), against head as the control.
set -u
R=/root/v13682/rig; N=/usr/bin/node; L=$R/out/mj.log; : > $L
until grep -q "P9-DONE" $R/out/p9.log 2>/dev/null; do sleep 20; done
echo "MJ-START $(date -u +%T)" >> $L
for JAR in hJ14 hJ11 h; do DB=m$JAR
  echo "## jar $JAR" >> $L
  bash $R/stop.sh $DB all >> $L 2>&1; sleep 1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB h 2>&1 | tail -1 >> $L
  ROLE=store bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L; STORE=b APPROVAL=yolo DIST=h bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L
  run() { echo "### [$JAR $(date -u +%T)] $*" >> $L; (cd $R/probe && env DB=$DB "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
  [ $JAR != hJ11 ] && run $N p5-lost-reply.mjs turn ws-m5 a
  [ $JAR != hJ14 ] && run env EMPTY=1 HOLD=6000 $N p6-barrier.mjs ws-m6 b close
  bash $R/stop.sh $DB all >> $L 2>&1
  sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13682/rig/dist/\")==1 {print \$1}"); [ -n "$W" ] && kill $W 2>/dev/null
done
echo "MJ-DONE $(date -u +%T)" >> $L
