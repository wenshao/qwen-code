#!/bin/bash
# A/A: re-run the two G1 errors alone, 3x each, on the trial merge (m4) and on current main (main4).
R=/Users/wenshao/pr13554-rig; L=$R/logs/gates4/aa; mkdir -p $L
for arm in m4 main4; do
  if [ $arm = m4 ]; then M=$R/g1/packages/sdk-java/managed-agent-server; else M=$R/wt-main4/packages/sdk-java/managed-agent-server; fi
  cd $M
  for i in 1 2 3; do
    mvn -B -o -Dmaven.repo.local=$R/m2-$arm -Dmaven.repo.local.tail=/m2tail -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true \
      '-Dtest=RuntimeBrokerFlywaySchemaTest,ToolPublicationStoreTest#streamsLargeOutputAndReadsItsTailAfterStoreReplacement' \
      -Dsurefire.failIfNoSpecifiedTests=false test > $L/$arm-$i.log 2>&1
    echo "$arm run $i exit=$? $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $L/$arm-$i.log | tail -1)" | tee -a $L/summary.txt
  done
done
echo AA-DONE >> $L/summary.txt
