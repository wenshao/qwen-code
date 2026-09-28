#!/bin/bash
# round 3 stage "real": fault gates, real-worker IT, both MySQL ITs against host MySQL on 33306.
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/r3; mkdir -p $O
MYSQL="-Dmysql.user=root -Dmysql.password=rootpw"; STAMP=$(date +%s); CLI=/rig/wt-v4/dist/cli.js
summary() { grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' "$1" | tail -1 | sed 's/^\[[A-Z]*\] //'; }
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sed -E 's/com\.alibaba\.qwen\.code\.(runtimebroker|managedagent)\.//' | sort -u | tr '\n' ';'; }
prep() { rm -rf $2 && mkdir -p $2 && cp -a /rig/$1/. $2/ && (cd $2/packages/sdk-java/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1); }
for arm in head cand; do
  tree=src-v4; label=8c2b626c; [ $arm = cand ] && { tree=cand-src-v4; label=candidate; }
  prep $tree /r-$arm
  (cd /r-$arm/packages/sdk-java/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install > $O/real-build-$arm.log 2>&1)
  (cd /r-$arm/packages/sdk-java/runtime-broker && mvn -B -ntp test -Pfault-gates -Dqwen.cli.entry=$CLI > $O/$arm-gates.log 2>&1; echo "[$label] fault gates: exit=$? $(summary $O/$arm-gates.log) $(failing $O/$arm-gates.log)")
  (cd /r-$arm/packages/sdk-java/managed-agent-server && mvn -B -ntp verify -Phosted-harness-mysql -Dcheckstyle.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=WorkspaceRecoveryWorkerIT -Dqwen.runtime.worker.bundle=$CLI > $O/$arm-it-recovery.log 2>&1; echo "[$label] WorkspaceRecoveryWorkerIT: exit=$? $(summary $O/$arm-it-recovery.log) $(failing $O/$arm-it-recovery.log)")
  if [ $arm = head ]; then
    (cd /r-$arm/packages/sdk-java/runtime-broker && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=JdbcRepositoryTest "-Dmysql.url=jdbc:mysql://127.0.0.1:33306/r3_broker_$STAMP?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" $MYSQL > $O/$arm-mysql-broker.log 2>&1; echo "[$label] broker MySQL IT: exit=$? $(grep -E 'Tests run:.*-- in .*MySqlIT' $O/$arm-mysql-broker.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed.*//') $(failing $O/$arm-mysql-broker.log)")
    (cd /r-$arm/packages/sdk-java/managed-agent-server && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false "-Dmysql.url=jdbc:mysql://127.0.0.1:33306/r3_server_$STAMP?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" $MYSQL > $O/$arm-mysql-server.log 2>&1; echo "[$label] server MySQL IT: exit=$? $(grep -E 'Tests run:.*-- in .*MySqlIT' $O/$arm-mysql-server.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed.*//') $(failing $O/$arm-mysql-server.log)")
  fi
done
echo STAGE-REAL-DONE
