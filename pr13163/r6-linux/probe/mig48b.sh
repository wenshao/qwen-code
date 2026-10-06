#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R6): V47+V48 rolling upgrade rerun, waiting out the old replica attachment first.
until grep -q "UI6 rc=" /root/v13163/rig/out/seq6.log 2>/dev/null; do sleep 10; done
R=/root/v13163/rig; P=$R/probe; N=/usr/bin/node; DB=m48b
L=$R/out/b6/mig48b.log; : > $L
run() { echo "### $*" >> $L; (cd $P && env "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
bash $R/aux.sh $DB >> $L 2>&1; bash $R/harness.sh $DB head2 >> $L 2>&1
ROLE=store bash $R/spring.sh head2 $DB >> $L 2>&1; STORE=b DIST=head2 bash $R/spring.sh head2 $DB >> $L 2>&1
run DB=$DB $N mig48-upgrade.mjs before ws-m48 a
echo "### rolling upgrade: replica A -> head3 jar (Store replica B stays on head2)" >> $L
bash $R/stop.sh $DB spring >> $L 2>&1; STORE=b DIST=head2 bash $R/spring.sh head3 $DB >> $L 2>&1
grep -E "Migrating schema|Successfully applied|Successfully validated" $R/run/$DB/spring-1.log | cut -c1-240 >> $L
run DB=$DB WAIT_MS=70000 $N mig48-upgrade.mjs after ws-m48 a
bash $R/stop.sh $DB all >> $L 2>&1
echo "MIG48B-DONE $(date -u +%T)" >> $L
