#!/bin/bash
# container (dedicated VM, --network host): head 9a1de09e — stage "jars" builds both jars and runs the unit suites,
# stage "real" runs what needs the worker bundle or MySQL.
set -u
STAGE=${1:-jars}
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/v3; mkdir -p $O
summary() { grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' "$1" | tail -1 | sed 's/^\[[A-Z]*\] //'; }
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sed -E 's/com\.alibaba\.qwen\.code\.(runtimebroker|managedagent)\.//' | sort -u | tr '\n' ';'; }
prep() { # <tree> <workdir>
  rm -rf $2 && mkdir -p $2 && cp -a /rig/$1/. $2/
  (cd $2/packages/sdk-java/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
}
if [ $STAGE = jars ]; then
  for arm in cand head; do
    tree=src-v3; [ $arm = cand ] && tree=cand-src-v3
    prep $tree /w-$arm
    (cd /w-$arm/packages/sdk-java/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install > $O/build-$arm.log 2>&1)
    (cd /w-$arm/packages/sdk-java/managed-agent-server && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true package >> $O/build-$arm.log 2>&1 && cp target/qwen-managed-agent-server-0.1.0-alpha.jar /rig/server/v3-$arm-server.jar)
    echo "[build] v3-$arm-server.jar $(ls -la /rig/server/v3-$arm-server.jar 2>&1 | awk '{print $5}') bytes"
  done
  echo JARS-READY
  # head is installed last, so the local repository holds the head broker for the head server suite
  (cd /w-head/packages/sdk-java/runtime-broker && mvn -B -ntp install > $O/head-u-broker.log 2>&1; echo "[9a1de09e] broker unit + checkstyle: exit=$? $(summary $O/head-u-broker.log) $(failing $O/head-u-broker.log)")
  (cd /w-head/packages/sdk-java/managed-agent-server && mvn -B -ntp test > $O/head-u-server.log 2>&1; echo "[9a1de09e] server unit + checkstyle: exit=$? $(summary $O/head-u-server.log) $(failing $O/head-u-server.log)")
  cp /rig/cand/MaintenanceProbeWaiterTest.java /rig/cand/RebootRecoveryGapTest.java /w-head/packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/
  (cd /w-head/packages/sdk-java/runtime-broker && mvn -B -ntp test -Dtest='MaintenanceProbeWaiterTest,RebootRecoveryGapTest' -Dcheckstyle.skip=true > $O/head-newtests.log 2>&1; echo "[9a1de09e] F1 test + gap tests: exit=$? $(summary $O/head-newtests.log) $(failing $O/head-newtests.log)")
  rm /w-head/packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/MaintenanceProbeWaiterTest.java /w-head/packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/RebootRecoveryGapTest.java
  (cd /w-cand/packages/sdk-java/runtime-broker && mvn -B -ntp install > $O/cand-u-broker.log 2>&1; echo "[candidate] broker unit + checkstyle (incl. 3 new tests): exit=$? $(summary $O/cand-u-broker.log) $(failing $O/cand-u-broker.log)")
  (cd /w-cand/packages/sdk-java/managed-agent-server && mvn -B -ntp test > $O/cand-u-server.log 2>&1; echo "[candidate] server unit + checkstyle: exit=$? $(summary $O/cand-u-server.log) $(failing $O/cand-u-server.log)")
  echo STAGE-JARS-DONE
else
  MYSQL="-Dmysql.user=root -Dmysql.password=rootpw"; STAMP=$(date +%s); CLI=/rig/wt-v3/dist/cli.js
  for arm in head cand; do
    tree=src-v3; label=9a1de09e; [ $arm = cand ] && { tree=cand-src-v3; label=candidate; }
    prep $tree /r-$arm
    (cd /r-$arm/packages/sdk-java/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install > $O/real-build-$arm.log 2>&1)
    (cd /r-$arm/packages/sdk-java/runtime-broker && mvn -B -ntp test -Pfault-gates -Dqwen.cli.entry=$CLI > $O/$arm-gates.log 2>&1; echo "[$label] fault gates: exit=$? $(summary $O/$arm-gates.log) $(failing $O/$arm-gates.log)")
    (cd /r-$arm/packages/sdk-java/managed-agent-server && mvn -B -ntp verify -Phosted-harness-mysql -Dcheckstyle.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=WorkspaceRecoveryWorkerIT -Dqwen.runtime.worker.bundle=$CLI > $O/$arm-it-recovery.log 2>&1; echo "[$label] WorkspaceRecoveryWorkerIT: exit=$? $(summary $O/$arm-it-recovery.log) $(failing $O/$arm-it-recovery.log)")
    if [ $arm = head ]; then
      (cd /r-$arm/packages/sdk-java/runtime-broker && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=JdbcRepositoryTest "-Dmysql.url=jdbc:mysql://127.0.0.1:3306/v3_broker_$STAMP?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" $MYSQL > $O/$arm-mysql-broker.log 2>&1; echo "[$label] broker MySQL IT: exit=$? $(grep -E 'Tests run:.*-- in .*MySqlIT' $O/$arm-mysql-broker.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed.*//') $(failing $O/$arm-mysql-broker.log)")
      (cd /r-$arm/packages/sdk-java/managed-agent-server && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false "-Dmysql.url=jdbc:mysql://127.0.0.1:3306/v3_server_$STAMP?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" $MYSQL > $O/$arm-mysql-server.log 2>&1; echo "[$label] server MySQL IT: exit=$? $(grep -E 'Tests run:.*-- in .*MySqlIT' $O/$arm-mysql-server.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed.*//') $(failing $O/$arm-mysql-server.log)")
    fi
  done
  echo STAGE-REAL-DONE
fi
