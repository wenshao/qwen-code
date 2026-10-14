#!/bin/bash
# PR's own Java tests on the trial merge (JDK 21, isolated m2).
set -u
RIG=/Users/wenshao/pr13986-rig; SJ=$RIG/src-pr/packages/sdk-java; L=$RIG/out/test-java3.log
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN=/Users/wenshao/Install/maven/bin/mvn; R="-Dmaven.repo.local=$RIG/m2"
: > $L
echo "=== $(date +%T) broker tests" | tee -a $L
(cd $SJ/runtime-broker && $MVN -B -ntp $R -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dgpg.skip=true \
  -Dtest='RuntimeBrokerServiceTest,RuntimeBrokerHttpServerTest,BindingExecutionInventoryTest,InMemoryRepositoryTest,JdbcRepositoryTest,ManagedSchemaTest,ManagedSchemaCatalogTest' \
  -Dsurefire.failIfNoSpecifiedTests=false test) >> $L 2>&1; echo "broker tests exit=$?" | tee -a $L
grep -E 'Tests run:.*(Fail|Err)|Tests run: [0-9]+, Failures' $L | tail -12 | tee -a $L.summary
(cd $SJ/runtime-broker && $MVN -B -ntp -q $R -Dmaven.test.skip=true -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dgpg.skip=true install) >> $L 2>&1; echo "broker install(pr) exit=$?" | tee -a $L
echo "=== $(date +%T) server schema tests" | tee -a $L
(cd $SJ/managed-agent-server && $MVN -B -ntp $R -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dgpg.skip=true \
  -Dtest='RuntimeBrokerFlywaySchemaTest' -Dsurefire.failIfNoSpecifiedTests=false test) >> $L 2>&1; echo "server tests exit=$?" | tee -a $L
grep -E 'Tests run: [0-9]+, Failures' $L | tail -4 | tee -a $L.summary
echo "=== $(date +%T) TEST-JAVA-DONE" | tee -a $L
