#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R5): cold-attachment-cache cancels without a Session Store outage. Replica B serves
# the Session Store; replica A (dispatch + embedded Broker) is the one restarted.  usage: cold5.sh <db> <jar> <dist>
set -u
R=/root/v13163/rig; DB=$1; JAR=$2; D=$3; P=$R/probe; N=/usr/bin/node
L=$R/out/$DB/cold5.log; mkdir -p $(dirname $L); : > $L
run() { echo "### $*" >> $L; (cd $P && env DB=$DB "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
restartA() { echo "### restart replica A only (Session Store on B stays up)" >> $L; bash $R/stop.sh $DB spring >> $L 2>&1; STORE=b DIST=$D bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L; }
echo "COLD-START $(date -u +%T) db=$DB jar=$JAR dist=$D" >> $L
bash $R/aux.sh $DB >> $L 2>&1
bash $R/harness.sh $DB $D >> $L 2>&1
ROLE=store bash $R/spring.sh $JAR $DB >> $L 2>&1
STORE=b DIST=$D bash $R/spring.sh $JAR $DB >> $L 2>&1
for m in revoke none; do
  run $N c14-cold-cache.mjs start ws-k5$m a $m
  restartA
  run $N c14-cold-cache.mjs cancel ws-k5$m a $m
done
run $N w2c-cwd-cancel.mjs start ws-w5c h
restartA
run $N w2c-cwd-cancel.mjs cancel ws-w5c h
echo "COLD-DONE $(date -u +%T)" >> $L
