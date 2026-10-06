#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R6): r62 and r63 on the per-attempt boundary prototype (13df2a65 + patch, no V48).
until grep -q MIG48B-DONE /root/v13163/rig/out/b6/mig48b.log 2>/dev/null && [ -f /root/v13163/rig/server/proto-server.jar ]; do sleep 10; done
R=/root/v13163/rig; P=$R/probe; N=/usr/bin/node; DB=p63
L=$R/out/b6/proto6.log; : > $L
run() { echo "### $*" >> $L; (cd $P && env DB=$DB "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
bash $R/aux.sh $DB >> $L 2>&1; bash $R/harness.sh $DB head3 >> $L 2>&1
ROLE=store bash $R/spring.sh proto $DB >> $L 2>&1; STORE=b DIST=head3 bash $R/spring.sh proto $DB >> $L 2>&1
run $N r62-rename-race.mjs bound ws-r62p d
run $N r63-older-inflight.mjs bound ws-r63p d
bash $R/stop.sh $DB all >> $L 2>&1
echo "PROTO6-DONE $(date -u +%T)" >> $L
