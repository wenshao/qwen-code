#!/bin/bash
# 0bf20143 MySQL RR witness on real MySQL 8.4 (green), its no-FOR-UPDATE mutant (expect red), then unit suites. Runs in pr13550-base.
set -u
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/maven/bin:$PATH
RIG=/Users/wenshao/git/pr13550-rig; WT=/Users/wenshao/git/pr13550-base; M2=$RIG/m2-ab
cd $WT && git checkout -q --detach 0bf201436c && echo "base at $(git rev-parse --short HEAD)"
for m in qwencode runtime-broker; do (cd packages/sdk-java/$m && mvn -B -q -o -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip -Dspotless.check.skip=true -Dgpg.skip -Dmaven.javadoc.skip=true -Dmaven.source.skip=true install) || { echo "INSTALL FAIL $m"; exit 2; }; done
(cd packages/sdk-java/managed-agent-server && mvn -B -q -o -Dmaven.repo.local=$M2 clean) || { echo "CLEAN FAIL"; exit 3; }
ls packages/sdk-java/managed-agent-server/target 2>/dev/null | head -1
S=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecordStore.java
it() { "$RIG/mysql.sh" sql -e "DROP DATABASE IF EXISTS $1; CREATE DATABASE $1" || return 9
  (cd packages/sdk-java/managed-agent-server && mvn -B -o -Dmaven.repo.local=$M2 -Dcheckstyle.skip -Dspotless.check.skip=true -Pmysql-integration verify \
     -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=ManagedExtensionRecordVerdictReconcileMySqlIT -Dfailsafe.failIfNoSpecifiedTests=false \
     "-Dmysql.url=jdbc:mysql://127.0.0.1:33550/$1?useSSL=false&allowPublicKeyRetrieval=true" -Dmysql.user=root) > $RIG/it-$1.log 2>&1
  echo "$1: $(grep -E 'Tests run:.*Fail' $RIG/it-$1.log | grep -v ' in ' | tail -1) $(grep -E 'BUILD (SUCCESS|FAILURE)' $RIG/it-$1.log)"; }
echo "isolation: $("$RIG/mysql.sh" sql -N -e 'SELECT @@global.transaction_isolation, VERSION()')"
it rit16a
grep -c "parent_child_run_id = ? FOR UPDATE" $S
sed -i '' 's/+ " AND parent_child_run_id = ? FOR UPDATE",/+ " AND parent_child_run_id = ?",/' $S && git diff --stat | tail -1
it rit16b
grep -A3 "theVerdictSeesAMint" $RIG/it-rit16b.log | grep -E "Expecting|FAIL|AssertionError" | head -2 | cut -c1-200
git checkout -q -- $S && git diff --quiet && echo "restored clean"
L=$RIG/test-r10b-java.log; : > $L
(cd packages/sdk-java/managed-agent-server && mvn -B -o -Dmaven.repo.local=$M2 -Dcheckstyle.skip -Dspotless.check.skip=true test -Dtest='ChildResultRelayStoreTest,ManagedCwdChangeOperationTest,ManagedExtensionRecordStoreTest,ManagedSessionOperationMigrationTest,RuntimeBrokerConfigurationTest,QwenHostedHarnessConnectorTest,ChildResultRelayTest,SessionLifecycleCoordinatorTest,RuntimeBrokerConfigurationIntegrationTest,SessionLifecycleProtocolChoiceTest,ManagedExtensionRecordLifecycleGateTest,QwenHostedHarnessColdCancelRegressionTest,ManagedAgentStoreChildCreationFenceTest,ManagedExtensionRecordVerdictReconcileTest' -Dsurefire.failIfNoSpecifiedTests=false >> $L 2>&1)
(cd packages/sdk-java/qwencode && mvn -B -o -Dmaven.repo.local=$M2 -Dcheckstyle.skip -Dspotless.check.skip=true -Dgpg.skip test -Dtest='HostedHarnessClientTest' -Dsurefire.failIfNoSpecifiedTests=false >> $L 2>&1)
(cd packages/sdk-java/runtime-broker && mvn -B -o -Dmaven.repo.local=$M2 -Dcheckstyle.skip -Dspotless.check.skip=true -Dgpg.skip test -Dtest='RuntimeBrokerServiceBindingReadTest' -Dsurefire.failIfNoSpecifiedTests=false >> $L 2>&1)
grep -E "Tests run: [0-9]+, Fail.*$|BUILD" $L | grep -v " in "
"$RIG/mysql.sh" sql -e "DROP DATABASE IF EXISTS rit16c; CREATE DATABASE rit16c"
(cd packages/sdk-java/managed-agent-server && mvn -B -o -Dmaven.repo.local=$M2 -Dcheckstyle.skip -Dspotless.check.skip=true -Pmysql-integration verify \
   -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=WorkspaceMigrationMySqlIT -Dfailsafe.failIfNoSpecifiedTests=false \
   "-Dmysql.url=jdbc:mysql://127.0.0.1:33550/rit16c?useSSL=false&allowPublicKeyRetrieval=true" -Dmysql.user=root) > $RIG/it-rit16c.log 2>&1
echo "WorkspaceMigrationMySqlIT: $(grep -E 'Tests run:.*Fail' $RIG/it-rit16c.log | grep -v ' in ' | tail -1) $(grep -E 'BUILD (SUCCESS|FAILURE)' $RIG/it-rit16c.log)"
echo "it-r10b DONE"
