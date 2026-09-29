#!/bin/bash
# container (dedicated VM, --network host, nothing else running): head 55ded4c3
set -u
STAGE=${1:-jars}
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/v4; mkdir -p $O
summary() { grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' "$1" | tail -1 | sed 's/^\[[A-Z]*\] //'; }
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sed -E 's/com\.alibaba\.qwen\.code\.(runtimebroker|managedagent)\.//' | sort -u | tr '\n' ';'; }
W=/w-v4; SJ=$W/packages/sdk-java
rm -rf $W && mkdir -p $W && cp -a /rig/src-v4/. $W/
(cd $SJ/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
if [ $STAGE = jars ]; then
  (cd $SJ/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install > $O/build.log 2>&1)
  (cd $SJ/managed-agent-server && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true package >> $O/build.log 2>&1 && cp target/qwen-managed-agent-server-0.1.0-alpha.jar /rig/server/v4-head-server.jar)
  echo "[build] v4-head-server.jar $(ls -la /rig/server/v4-head-server.jar 2>&1 | awk '{print $5}') bytes"; echo JARS-READY
  (cd $SJ/runtime-broker && mvn -B -ntp install > $O/head-u-broker.log 2>&1; echo "[55ded4c3] broker unit + checkstyle: exit=$? $(summary $O/head-u-broker.log) $(failing $O/head-u-broker.log)")
  (cd $SJ/managed-agent-server && mvn -B -ntp test > $O/head-u-server.log 2>&1; echo "[55ded4c3] server unit + checkstyle: exit=$? $(summary $O/head-u-server.log) $(failing $O/head-u-server.log)")
  (cd $SJ/runtime-broker && mvn -B -ntp test -Dtest='MaintenanceProbeWaiterTest,RuntimeMaintenanceRecoveryTest' -Dcheckstyle.skip=true > $O/head-newtests.log 2>&1; echo "[55ded4c3] MaintenanceProbeWaiterTest + RuntimeMaintenanceRecoveryTest: exit=$? $(summary $O/head-newtests.log) $(failing $O/head-newtests.log)")
  cp /rig/cand/RebootRecoveryGapTest.java $SJ/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/
  (cd $SJ/runtime-broker && mvn -B -ntp test -Dtest='RebootRecoveryGapTest' -Dcheckstyle.skip=true > $O/head-gaptest.log 2>&1; echo "[55ded4c3] my RebootRecoveryGapTest dropped in: exit=$? $(summary $O/head-gaptest.log) $(failing $O/head-gaptest.log)")
  echo STAGE-JARS-DONE
else
  MYSQL="-Dmysql.user=root -Dmysql.password=rootpw"; STAMP=$(date +%s); CLI=/rig/wt-v3/dist/cli.js
  (cd $SJ/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install > $O/real-build.log 2>&1)
  (cd $SJ/runtime-broker && mvn -B -ntp test -Pfault-gates -Dqwen.cli.entry=$CLI > $O/head-gates.log 2>&1; echo "[55ded4c3] fault gates: exit=$? $(summary $O/head-gates.log) $(failing $O/head-gates.log)")
  (cd $SJ/managed-agent-server && mvn -B -ntp verify -Phosted-harness-mysql -Dcheckstyle.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=WorkspaceRecoveryWorkerIT -Dqwen.runtime.worker.bundle=$CLI > $O/head-it-recovery.log 2>&1; echo "[55ded4c3] WorkspaceRecoveryWorkerIT: exit=$? $(summary $O/head-it-recovery.log) $(failing $O/head-it-recovery.log)")
  (cd $SJ/runtime-broker && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=JdbcRepositoryTest "-Dmysql.url=jdbc:mysql://127.0.0.1:3306/v4_broker_$STAMP?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" $MYSQL > $O/head-mysql-broker.log 2>&1; echo "[55ded4c3] broker MySQL IT: exit=$? $(grep -E 'Tests run:.*-- in .*MySqlIT' $O/head-mysql-broker.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed.*//') $(failing $O/head-mysql-broker.log)")
  (cd $SJ/managed-agent-server && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false "-Dmysql.url=jdbc:mysql://127.0.0.1:3306/v4_server_$STAMP?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" $MYSQL > $O/head-mysql-server.log 2>&1; echo "[55ded4c3] server MySQL IT: exit=$? $(grep -E 'Tests run:.*-- in .*MySqlIT' $O/head-mysql-server.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed.*//') $(failing $O/head-mysql-server.log)")
  echo STAGE-REAL-DONE
fi
