#!/bin/bash
# PR #13135 focused tests on the head worktree: Broker unit + MySQL IT, Managed unit + MySQL IT, TS Harness suite.
R=/Users/wenshao/pr13135-rig; W=$R/wt/packages/sdk-java
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
M="-B -ntp -o -Dmaven.repo.local=$R/m2"
DBU="-Dmysql.user=root -Dmysql.password=rig13135"
/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -h127.0.0.1 -P33135 -uroot -prig13135 -e "DROP DATABASE IF EXISTS rb_it; CREATE DATABASE rb_it; DROP DATABASE IF EXISTS ma_it" 2>/dev/null
(cd $W/runtime-broker && mvn $M -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:33135/rb_it?allowPublicKeyRetrieval=true&useSSL=false" $DBU \
  -Dtest='RuntimeHarnessDrainTest,LocalProcessStopExecutorTest,DurableLocalProcessRuntimeProvisionerTest,DurableRuntimeRecoveryTest,InMemoryRuntimeBindingRepositoryTest' -Dsurefire.failIfNoSpecifiedTests=false \
  -Dit.test='JdbcRuntimeBrokerMySqlIT' -Dfailsafe.failIfNoSpecifiedTests=false clean install checkstyle:check > $R/out/unit-broker.log 2>&1; echo "broker exit=$?")
(cd $W/managed-agent-server && mvn $M -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:33135/ma_it?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" $DBU \
  -Dtest='WorkspaceSessionCloseTest,SessionLifecycleCoordinatorTest,ManagedSessionOperationStoreTest,WorkspaceRuntimeTest,ManagedAgentApiContractTest,ManagedArtifactApiIntegrationTest' -Dsurefire.failIfNoSpecifiedTests=false \
  -Dit.test='WorkspaceSessionCloseMySqlIT' -Dfailsafe.failIfNoSpecifiedTests=false clean verify checkstyle:check > $R/out/unit-managed.log 2>&1; echo "managed exit=$?")
(cd $R/wt/packages/cli && npx vitest run src/serve/hosted-harness-session.test.ts > $R/out/unit-ts.log 2>&1; echo "ts exit=$?")
grep -E "Tests run:.*Fail" $R/out/unit-broker.log $R/out/unit-managed.log | grep -v "Tests run: 0" | sed 's#.*/out/##' | tail -30
grep -E "Test Files|Tests  " $R/out/unit-ts.log
echo UNIT-DONE
