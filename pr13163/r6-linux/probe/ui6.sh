#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R6): WebShell cancel screenshots on 13df2a65 (en revoke, zh draining).
R=/root/v13163/rig; DB=u63; A=head3; N=/usr/bin/node; L=$R/out/$DB/ui6.log; mkdir -p $R/out/$DB; : > $L
run() { echo "### $*" >> $L; (cd $R/probe && env DB=$DB ARM=$A "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
bash $R/aux.sh $DB >> $L 2>&1; bash $R/harness.sh $DB $A >> $L 2>&1
ROLE=store bash $R/spring.sh $A $DB >> $L 2>&1; STORE=b DIST=$A bash $R/spring.sh $A $DB >> $L 2>&1
bash $R/vite.sh $A >> $L 2>&1
run $N c13-ui-cancel.mjs ws-u1-h3 b revoke en
run $N c13-ui-cancel.mjs ws-u2-h3 c draining zh
kill $(cat $R/run/vite-$A.pid) 2>/dev/null
bash $R/stop.sh $DB all >> $L 2>&1
echo "UI6-DONE $(date -u +%T)" >> $L
