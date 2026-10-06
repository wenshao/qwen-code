#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R6): V47+V48 rolling upgrade rerun, restarting the Harness too and waiting out the old writer lease.
true
R=/root/v13163/rig; P=$R/probe; N=/usr/bin/node; DB=m48d
L=$R/out/b6/mig48d.log; : > $L
run() { echo "### $*" >> $L; (cd $P && env "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
bash $R/aux.sh $DB >> $L 2>&1; bash $R/harness.sh $DB head2 >> $L 2>&1
ROLE=store bash $R/spring.sh head2 $DB >> $L 2>&1; STORE=b DIST=head2 bash $R/spring.sh head2 $DB >> $L 2>&1
run DB=$DB $N mig48-upgrade.mjs before ws-m48 a
echo "### rolling upgrade: replica A -> head3 jar and Harness -> head3 bundle (Store replica B stays on head2)" >> $L
bash $R/stop.sh $DB spring >> $L 2>&1; bash $R/stop.sh $DB harness >> $L 2>&1; bash $R/harness.sh $DB head3 >> $L 2>&1; STORE=b DIST=head3 bash $R/spring.sh head3 $DB >> $L 2>&1
grep -E "Migrating schema|Successfully applied|Successfully validated" $R/run/$DB/spring-1.log | cut -c1-240 >> $L
run DB=$DB WAIT_MS=70000 $N mig48-upgrade.mjs after ws-m48 a
bash $R/stop.sh $DB all >> $L 2>&1
echo "MIG48D-DONE $(date -u +%T)" >> $L
