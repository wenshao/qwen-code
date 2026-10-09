#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673): targeted Java tests for one worktree.  usage: jtest.sh <worktree-dir> <m2-arm> <tag>
W=$1; M2=/Users/wenshao/pr13673-rig/m2-$2; T=$3; O=/Users/wenshao/pr13673-rig/out/jtest-$T.log
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
SJ=$W/packages/sdk-java; : > $O
(cd $SJ/runtime-broker && mvn -B -ntp -Dmaven.repo.local=$M2 -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dsurefire.failIfNoSpecifiedTests=false \
  -Dtest='RuntimeHarnessDrainTest,InMemoryRepositoryTest,JdbcRepositoryTest' install >> $O 2>&1); echo "[$T] broker exit=$?"
(cd $SJ/managed-agent-server && mvn -B -ntp -Dmaven.repo.local=$M2 -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dsurefire.failIfNoSpecifiedTests=false \
  -Dtest='WorkspaceRuntimeTest,RuntimeBrokerFlywaySchemaTest,SessionLifecycleCoordinatorTest' test >> $O 2>&1); echo "[$T] server exit=$?"
grep -E "Tests run:.*Fail" $O | grep -v "Time elapsed" | tail -4
