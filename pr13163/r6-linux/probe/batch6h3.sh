#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R6): real-stack set on the new head 13df2a65 (arm head3), Session Store on replica B.
set -u
R=/root/v13163/rig; DB=h63; A=head3; P=$R/probe; N=/usr/bin/node
L=$R/out/$DB/batch6h3.log; mkdir -p $(dirname $L); : > $L
run() { echo "### $*" >> $L; (cd $P && env DB=$DB "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
restartA() { echo "### restart replica A only" >> $L; bash $R/stop.sh $DB spring >> $L 2>&1; STORE=b DIST=$A bash $R/spring.sh $A $DB 2>&1 | tail -1 >> $L; }
echo "H3-START $(date -u +%T)" >> $L
bash $R/aux.sh $DB >> $L 2>&1; bash $R/harness.sh $DB $A >> $L 2>&1
ROLE=store bash $R/spring.sh $A $DB >> $L 2>&1; STORE=b DIST=$A bash $R/spring.sh $A $DB >> $L 2>&1
run $N c1-cancel-refused.mjs ws-a a revoke alice
run $N c1-cancel-refused.mjs ws-b b draining alice
run $N c1-cancel-refused.mjs ws-c c regen alice
run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g control mallory
run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g control bob
run $N c5-regen-admission.mjs ws-c5a a regen
run $N f4r-real-lifecycle.mjs ws-f4r f
run $N w2c-cwd-cancel.mjs live ws-w2l h
run $N r62-rename-race.mjs bound ws-r62 d
run $N r63-older-inflight.mjs bound ws-r63 d
run $N c14-cold-cache.mjs start ws-kh3 e revoke
restartA
run $N c14-cold-cache.mjs cancel ws-kh3 e revoke
bash $R/vite.sh $A >> $L 2>&1
run env ARM=$A $N c13-ui-cancel.mjs ws-u1-h3 b revoke en
run env ARM=$A $N c13-ui-cancel.mjs ws-u2-h3 c draining zh
kill $(cat $R/run/vite-$A.pid) 2>/dev/null
bash $R/stop.sh $DB all >> $L 2>&1
echo "H3-BATCH-DONE $(date -u +%T)" >> $L
