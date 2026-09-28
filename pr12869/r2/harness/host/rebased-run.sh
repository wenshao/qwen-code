#!/bin/bash
# container: the two stacked commits replayed onto main (one test-file conflict resolved by keeping both tests)
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/rebased; mkdir -p $O
summary() { grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' "$1" | tail -1 | sed 's/^\[[A-Z]*\] //'; }
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sed -E 's/com\.alibaba\.qwen\.code\.(runtimebroker|managedagent)\.//' | sort -u | tr '\n' ';'; }
W=/w-rebased; rm -rf $W && mkdir -p $W && cp -a /rig/src-rebased/. $W/
SJ=$W/packages/sdk-java; CLI=/rig/wt-main/dist/cli.js; MYSQL="-Dmysql.user=root -Dmysql.password=rootpw"; STAMP=$(date +%s); PORT=${MYSQL_PORT:-3306}
(cd $SJ/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
(cd $SJ/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install > $O/build.log 2>&1)
(cd $SJ/managed-agent-server && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true package >> $O/build.log 2>&1 && cp target/qwen-managed-agent-server-0.1.0-alpha.jar /rig/server/rebased-server.jar)
echo "[build] rebased-server.jar $(ls -la /rig/server/rebased-server.jar 2>&1 | awk '{print $5}') bytes"; echo JAR-READY
(cd $SJ/runtime-broker && mvn -B -ntp install > $O/u-broker.log 2>&1; echo "[rebased] broker unit + checkstyle: exit=$? $(summary $O/u-broker.log) $(failing $O/u-broker.log)")
(cd $SJ/managed-agent-server && mvn -B -ntp test > $O/u-server.log 2>&1; echo "[rebased] server unit + checkstyle: exit=$? $(summary $O/u-server.log) $(failing $O/u-server.log)")
(cd $SJ/runtime-broker && mvn -B -ntp test -Pfault-gates -Dqwen.cli.entry=$CLI > $O/gates.log 2>&1; echo "[rebased] fault gates: exit=$? $(summary $O/gates.log) $(failing $O/gates.log)")
(cd $SJ/managed-agent-server && mvn -B -ntp verify -Phosted-harness-mysql -Dcheckstyle.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=WorkspaceRecoveryWorkerIT -Dqwen.runtime.worker.bundle=$CLI > $O/it-recovery.log 2>&1; echo "[rebased] WorkspaceRecoveryWorkerIT: exit=$? $(summary $O/it-recovery.log) $(failing $O/it-recovery.log)")
(cd $SJ/runtime-broker && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=JdbcRepositoryTest "-Dmysql.url=jdbc:mysql://127.0.0.1:$PORT/rb_broker_$STAMP?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" $MYSQL > $O/mysql-broker.log 2>&1; echo "[rebased] broker MySQL IT: exit=$? $(grep -E 'Tests run:.*-- in .*MySqlIT' $O/mysql-broker.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed.*//') $(failing $O/mysql-broker.log)")
(cd $SJ/managed-agent-server && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false "-Dmysql.url=jdbc:mysql://127.0.0.1:$PORT/rb_server_$STAMP?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" $MYSQL > $O/mysql-server.log 2>&1; echo "[rebased] server MySQL IT: exit=$? $(grep -E 'Tests run:.*-- in .*MySqlIT' $O/mysql-server.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed.*//') $(failing $O/mysql-server.log)")
echo REBASED-DONE
