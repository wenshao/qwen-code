#!/bin/bash
# container (VM, Java 21 + Maven): targeted Java tests on the merged tree and on the V28 candidate.  usage: unit-java-m3.sh <tree>:<label> ...
set -u
O=/rig/out/unit-java; mkdir -p $O
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
TESTS='WorkspaceRecoveryStoreTest,WorkspaceStorageGuardTest,ManagedExtensionRecordStoreTest,ManagedHookRecordContractTest,ManagedHookCatalogContractTest,ManagedTurnQueryTest,RuntimeBrokerFlywaySchemaTest,ManagedSessionOperationMigrationTest,ManagedAgentApiContractTest,ToolPublicationStoreTest'
for spec in "$@"; do
  TREE=${spec%%:*}; L=${spec#*:}
  W=/u-$L; SJ=$W/packages/sdk-java
  rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
  (cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/$L.log 2>&1)
  (cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true install >> $O/$L.log 2>&1)
  (cd $SJ/managed-agent-server && mvn -B -ntp $R -Dtest="$TESTS" -Dsurefire.failIfNoSpecifiedTests=false test >> $O/$L.log 2>&1); echo "[$L] exit=$?"
  grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+, Time elapsed.* - in |^\[(ERROR|WARNING)\] Tests run:|Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$" $O/$L.log | sed -E 's/.* - in com\.alibaba\.qwen\.code\.managedagent\./  /' | tail -14
  grep -m2 -o "Found more than one migration with version [0-9]*" $O/$L.log
  rm -rf $W
done
echo UNIT-JAVA-DONE
