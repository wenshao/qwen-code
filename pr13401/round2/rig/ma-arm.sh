#!/bin/bash
# Usage: ma-arm.sh <tag> <worktree>  -> install qwencode+broker (no tests), run ManagedSessionStoreIntegrationTest
S=$SCRATCH
TAG=$1; WT=$2; export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH
M2=$S/m2/ma-$TAG; [ -d $M2 ] || cp -Rc $S/m2/seed $M2
LOG=$S/r2/ma-$TAG.log; : > $LOG
cd $WT/packages/sdk-java || exit 2
for m in qwencode runtime-broker; do
  mvn -B -o -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip -Dspotbugs.skip -Dgpg.skip -Dmaven.javadoc.skip -Dmaven.source.skip -f $m/pom.xml clean install >> $LOG 2>&1 || { echo "$TAG $m INSTALL-FAIL"; exit 1; }
done
t0=$(date +%s)
mvn -B -o -Dmaven.repo.local=$M2 -Dcheckstyle.skip -Dspotbugs.skip -Dtest=ManagedSessionStoreIntegrationTest -f managed-agent-server/pom.xml clean test >> $LOG 2>&1; rc=$?
echo "$TAG rc=$rc $(( $(date +%s)-t0 ))s $(grep -a -E 'Tests run:.*ManagedSessionStoreIntegrationTest|holdsRestorePages.*(ERROR|FAIL)|managed_session_extension_record_rejected' $LOG | head -3 | cut -c1-220 | tr '\n' ' ')" | tee -a $S/r2/ma-summary.txt
