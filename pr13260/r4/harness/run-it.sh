#!/bin/bash
# container (VM, Java 21 + Maven): W1c unit tests (H2) + MySQL ITs against the VM's MySQL 8.4.11.  usage: run-it.sh <tree> <label>
set -u
TREE=$1; L=$2; O=/rig/out/it; mkdir -p $O
W=/it-$L; SJ=$W/packages/sdk-java
rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
R="-Dmaven.repo.local=/root/.m2/repository"
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/$L.log 2>&1)
(cd $SJ/runtime-broker && mvn -B -ntp $R -Dcheckstyle.skip=true -Dtest='WorkspaceMigrationRepositoryTest,JdbcRepositoryTest,RuntimeBrokerServiceTest,LocalRuntimeStoreTest' -Dsurefire.failIfNoSpecifiedTests=false install >> $O/$L.log 2>&1); echo "[$L] broker focused tests + install exit=$?"
cd $SJ/managed-agent-server
mvn -B -ntp $R -Pmysql-integration -Dtest='WorkspaceMigrationStoreTest,ManagedWorkspaceAdmissionTest,ManagedActionsTest' -Dit.test='WorkspaceMigrationMySqlIT,WorkspaceSessionRetentionMySqlIT,WorkspaceSessionCloseMySqlIT' -Dsurefire.failIfNoSpecifiedTests=false -Dfailsafe.failIfNoSpecifiedTests=false \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:3306/mysql?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rootpw verify >> $O/$L.log 2>&1
echo "[$L] server exit=$?"
grep -E "Tests run:.*-- in |Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$|BUILD (SUCCESS|FAILURE)" $O/$L.log | tail -16
