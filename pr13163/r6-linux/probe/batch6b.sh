#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R6): r63 on the previous head 25eb9ae2 (A/B arm), then the V47+V48 rolling upgrade
# (old jar everywhere -> replica A restarted on the new jar while the Store replica keeps the old one).
set -u
R=/root/v13163/rig; P=$R/probe; N=/usr/bin/node
L=$R/out/b6/batch6b.log; mkdir -p $(dirname $L); : > $L
run() { echo "### $*" >> $L; (cd $P && env "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
echo "B6-START $(date -u +%T)" >> $L
DB=h62r
bash $R/aux.sh $DB >> $L 2>&1; bash $R/harness.sh $DB head2 >> $L 2>&1
ROLE=store bash $R/spring.sh head2 $DB >> $L 2>&1; STORE=b DIST=head2 bash $R/spring.sh head2 $DB >> $L 2>&1
run DB=$DB $N r63-older-inflight.mjs bound ws-r63b d
bash $R/stop.sh $DB all >> $L 2>&1
DB=m48
bash $R/aux.sh $DB >> $L 2>&1; bash $R/harness.sh $DB head2 >> $L 2>&1
ROLE=store bash $R/spring.sh head2 $DB >> $L 2>&1; STORE=b DIST=head2 bash $R/spring.sh head2 $DB >> $L 2>&1
run DB=$DB $N mig48-upgrade.mjs before ws-m48 a
echo "### rolling upgrade: replica A -> head3 jar (Store replica B stays on head2)" >> $L
bash $R/stop.sh $DB spring >> $L 2>&1; STORE=b DIST=head2 bash $R/spring.sh head3 $DB >> $L 2>&1
grep -E "Migrating schema|Successfully applied|Successfully validated" $R/run/$DB/spring-1.log | cut -c1-240 >> $L
run DB=$DB $N mig48-upgrade.mjs after ws-m48 a
bash $R/stop.sh $DB all >> $L 2>&1
echo "B6-DONE $(date -u +%T)" >> $L
