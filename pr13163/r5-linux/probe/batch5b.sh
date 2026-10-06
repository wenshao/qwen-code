#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R5): the A/B subset for the base arm (main side of the merge, 43a6e1e5).
set -u
R=/root/v13163/rig; DB=$1; JAR=$2; D=$3; P=$R/probe; N=/usr/bin/node
L=$R/out/$DB/batch5.log; mkdir -p $(dirname $L); : > $L
run() { echo "### $*" >> $L; (cd $P && env DB=$DB "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
echo "BATCH-START $(date -u +%T) db=$DB jar=$JAR dist=$D" >> $L
bash $R/aux.sh $DB >> $L 2>&1
bash $R/harness.sh $DB $D >> $L 2>&1
DIST=$D bash $R/spring.sh $JAR $DB >> $L 2>&1
run $N c1-cancel-refused.mjs ws-a a revoke alice
run $N c1-cancel-refused.mjs ws-b b draining alice
run $N c1-cancel-refused.mjs ws-c c regen alice
run $N c1-cancel-refused.mjs ws-f f control alice
run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g control mallory
run $N f4r-real-lifecycle.mjs ws-f4r f
run $N f4b-sql-state.mjs ws-f4b g
run $N w2c-cwd-cancel.mjs live ws-w2l h
echo "BATCH-DONE $(date -u +%T)" >> $L
