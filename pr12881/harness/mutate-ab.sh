#!/bin/bash
# A/B of the PR's own suites: unmutated, then each mutant (restored with git checkout between).
SP=$SP
cd $SP/wt-mut || exit 1
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$PATH
A="--batch-mode --no-transfer-progress -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2 -o"
M=packages/sdk-java/managed-agent-server
COORD=$M/src/main/java/com/alibaba/qwen/code/managedagent/service/SessionLifecycleCoordinator.java
STORE=$M/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedAgentStore.java
TESTS=ManagedSessionOperationStoreTest,ManagedSessionLifecycleTest,ManagedSessionOperationMigrationTest,ManagedAgentApiContractTest
run() {
  local tag=$1
  mvn $A -f $M/pom.xml -Dcheckstyle.skip -Dtest=$TESTS -Dsurefire.failIfNoSpecifiedTests=false test > $SP/logs/ab-$tag.log 2>&1
  echo "$tag rc=$? $(grep -E '^\[(ERROR|INFO|WARNING)\] Tests run:' $SP/logs/ab-$tag.log | tail -1)"
  grep -E '^\[ERROR\]   [A-Za-z]+\.[a-zA-Z]+' $SP/logs/ab-$tag.log | sed -E 's/:[0-9]+ .*//' | sort -u | head -8
}
git checkout -- $M
run base
perl -0pi -e 's/if \(sessionStore\.hasLiveWriter\(operation\.tenantId\(\),\n\s+operation\.sessionId\(\)\)\)/if (false)/' $COORD
git diff --stat | tail -1; run M1-no-live-writer-gate; git checkout -- $M
perl -0pi -e 's/\|\| operation\.claimGeneration\(\) != claimGeneration\)/)/' $STORE
git diff --stat | tail -1; run M3-no-claim-generation-check; git checkout -- $M
perl -0pi -e 's/harnessConfirmed = holder != null && holder\.equals\(answered\);/harnessConfirmed = answered != null;/' $COORD
git diff --stat | tail -1; run M2-any-answer-confirms; git checkout -- $M
git status --short | head -3
echo AB_DONE
