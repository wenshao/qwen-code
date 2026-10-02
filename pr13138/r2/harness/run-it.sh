#!/bin/bash
# container (VM, Java 21 + Maven): W1b unit tests (H2) + WorkspaceRecoveryMySqlIT against the VM's MySQL 8.4.11.  usage: run-it.sh <tree> <label>
set -u
TREE=$1; L=$2; O=/rig/out/it; mkdir -p $O
W=/it-$L; SJ=$W/packages/sdk-java
rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/$L.log 2>&1)
(cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true install >> $O/$L.log 2>&1)
cd $SJ/managed-agent-server
mvn -B -ntp $R -Pmysql-integration -Dtest='WorkspaceRecoveryStoreTest' -Dit.test='WorkspaceRecoveryMySqlIT' -Dsurefire.failIfNoSpecifiedTests=false -Dfailsafe.failIfNoSpecifiedTests=false \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:3306/mysql?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rootpw verify >> $O/$L.log 2>&1
echo "[$L] exit=$?"
grep -E "Tests run:.*(WorkspaceRecovery)|Tests run: [0-9]+, Failures" $O/$L.log | tail -6
