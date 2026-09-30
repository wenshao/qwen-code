#!/bin/bash
# VERIFICATION RIG ONLY. usage: run-matrix.sh "<variants>" "<mutations>" [suite]
#   suite: coord (default, -Dtest=HarnessCoordinatorTest) | full (whole unit suite)
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad
WT=$SP/wt-mut; MOD=packages/sdk-java/managed-agent-server
TEST=$MOD/src/test/java/com/alibaba/qwen/code/managedagent/service/HarnessCoordinatorTest.java
MAIN=$MOD/src/main/java/com/alibaba/qwen/code/managedagent/service/HarnessCoordinator.java
SUITE=${3:-coord}
export JAVA_HOME=$HOME/Install/jdk21 PATH=$HOME/Install/jdk21/bin:$HOME/Install/maven/bin:$PATH
A="--batch-mode --no-transfer-progress -o -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo"
cd $WT || exit 1
echo "# wt-mut HEAD=$(git rev-parse HEAD) suite=$SUITE $(date -u +%FT%TZ)"
for V in $1; do for M in $2; do
  cp $SP/mut/variants/$V.java $TEST
  node $SP/mut/mutate.mjs $M $SP/mut/HarnessCoordinator.pristine.java $MAIN > /dev/null || { echo "RESULT $V $M MUTATE_FAILED"; continue; }
  rm -rf $MOD/target/surefire-reports
  LOG=$SP/mut/logs/${ARM:-arm1}-$SUITE-$V-$M.log
  if [ "$SUITE" = full ]; then
    mvn $A -f $MOD/pom.xml -Dcheckstyle.skip test > $LOG 2>&1; RC=$?
  else
    mvn $A -f $MOD/pom.xml -Dcheckstyle.skip -Dtest=HarnessCoordinatorTest -Dsurefire.failIfNoSpecifiedTests=false test > $LOG 2>&1; RC=$?
  fi
  node $SP/mut/report.mjs $V $M $RC $MOD/target/surefire-reports $LOG $SUITE | tee -a $SP/mut/results-${ARM:-arm1}-$SUITE.jsonl.txt
done; done
# restore the tree
cp $SP/mut/variants/${RESTORE:-pr}.java $TEST; cp $SP/mut/HarnessCoordinator.pristine.java $MAIN
echo "# restored: dirty=$(git status --short | wc -l | tr -d ' ') HEAD=$(git rev-parse HEAD)"
