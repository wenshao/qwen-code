#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R5): the whole matrix for one arm.  usage: batch5.sh <db> <jar> <dist>
set -u
R=/root/v13163/rig; DB=$1; JAR=$2; D=$3; P=$R/probe; N=/usr/bin/node
L=$R/out/$DB/batch5.log; mkdir -p $(dirname $L); : > $L
run() { echo "### $*" >> $L; (cd $P && env DB=$DB "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
restart() { echo "### restart spring" >> $L; bash $R/stop.sh $DB spring >> $L 2>&1; DIST=$D bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L; }
echo "BATCH-START $(date -u +%T) db=$DB jar=$JAR dist=$D" >> $L
# cancel matrix (round 1-4 continuity)
run $N c1-cancel-refused.mjs ws-a a revoke alice
run $N c1-cancel-refused.mjs ws-b b draining alice
run $N c1-cancel-refused.mjs ws-c c regen alice
run $N c1-cancel-refused.mjs ws-d d storage alice
run $N c1-cancel-refused.mjs ws-e e unread alice
run env RESTORE=early $N c1-cancel-refused.mjs ws-ea a revoke alice
run env RESTORE=early $N c1-cancel-refused.mjs ws-eb b draining alice
run $N c1-cancel-refused.mjs ws-f f control alice
run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g control bob
run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g control carol
run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g control mallory
run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g revoke bob
run $N c5-regen-admission.mjs ws-c5a a regen
run $N c5-regen-admission.mjs ws-c5b b storage
run $N c7-replay-order.mjs ws-c7 c
for f in respond400 respond404 respond500 drop-before; do run $N c8-rename-refused.mjs bound ws-c8 d $f; done
run $N c3-lost-delivery.mjs bound ws-c3 e drop-before 1
run $N c16-page-caps.mjs ws-p1 a ws-p0 b regen
run $N c16-page-caps.mjs ws-p2 a ws-p0 b storage
# F4 (df8bdc56): real lifecycle API, then the SQL-state variant from round 4
run $N f4r-real-lifecycle.mjs ws-f4r f
run $N f4b-sql-state.mjs ws-f4b g
# merge with #13247 (W2): cwd change, then cancel under revoke+DRAINING, live and across a Spring restart
run $N w2c-cwd-cancel.mjs live ws-w2l h
run $N w2c-cwd-cancel.mjs start ws-w2c h
restart
run $N w2c-cwd-cancel.mjs cancel ws-w2c h
# cold attachment cache (round 3/4 continuity)
for m in revoke none; do
  run $N c14-cold-cache.mjs start ws-k$m a $m
  restart
  run $N c14-cold-cache.mjs cancel ws-k$m a $m
done
echo "BATCH-DONE $(date -u +%T)" >> $L
