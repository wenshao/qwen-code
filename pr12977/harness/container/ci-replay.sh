#!/bin/bash
# container (VM, --network host): sdk-java.yml Java-21 jobs step by step at one tree.
# usage: ci-replay.sh <tree> <label>     DBs: MariaDB 10.11.18 on 3307 (pw runtime-broker), MySQL 8.4 on 3306 (pw rootpw)
set -u
TREE=$1; L=$2
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/ci-$L; rm -rf $O; mkdir -p $O
W=/ci-$L; rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
cp -a /root/.m2/repository /m2; export MAVEN_ARGS="-Dmaven.repo.local=/m2"
CLI=$W/dist/cli.js
cd $W
S() { echo "[$L] $(date -u +%T) step '$1': exit=$2"; }
sum() { grep -E "Tests run:.*-- in " "$@" | sed -E 's/^[^:]+:\[[A-Z]+\] //; s/, Time elapsed[^-]*-- in / -- /' ; grep -E '<<< (FAILURE|ERROR)!' "$@" | head -8; grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' "$@" | tail -4; }
echo "[$L] env: machine-id=[$(cat /etc/machine-id)] kernel=$(uname -r) $(java -version 2>&1 | head -1) node=$(node -v)"
# --- job 'test' (ubuntu, java 21 parts)
(cd packages/sdk-java/qwencode && mvn --batch-mode --no-transfer-progress -q -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/0-qwencode.log 2>&1)
(cd packages/sdk-java/runtime-broker && mvn --batch-mode --no-transfer-progress clean test > $O/1-broker-test.log 2>&1); S "Run Runtime Broker state tests" $?
(cd packages/sdk-java/runtime-broker && mvn --batch-mode --no-transfer-progress checkstyle:check > $O/1b-broker-checkstyle.log 2>&1); S "Run Runtime Broker state Checkstyle" $?
grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures' $O/1-broker-test.log | tail -1; grep -E '<<< (FAILURE|ERROR)!' $O/1-broker-test.log | head -5
grep -E "Tests run:.*DurableLocalProcessRuntimeProvisionerTest" $O/1-broker-test.log | tail -1
# --- job 'mysql-integration' (MariaDB)
(cd packages/sdk-java/runtime-broker && mvn --batch-mode --no-transfer-progress -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:3307/runtime_broker_test?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=runtime-broker clean verify > $O/2-mariadb-broker.log 2>&1); S "MariaDB: Run Runtime Broker MySQL integration tests" $?
(mvn --batch-mode --no-transfer-progress -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install && mvn --batch-mode --no-transfer-progress -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install) > $O/3-install.log 2>&1; S "MariaDB: Install Managed Agent dependencies" $?
(cd packages/sdk-java/managed-agent-server && mvn --batch-mode --no-transfer-progress -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:3307/managed_agent_test?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=runtime-broker clean verify checkstyle:check > $O/4-mariadb-server.log 2>&1); S "MariaDB: Run Managed Agent tests, Checkstyle, and MySQL integration" $?
sum $O/2-mariadb-broker.log $O/4-mariadb-server.log | grep -E "IT$|IT |Tests run: [0-9]+, F|FAIL|ERROR" | head -20
grep -E "Tests run:.*(WorkspaceRuntimeTest|WorkspaceRecoveryCommandTest)" $O/4-mariadb-server.log | tail -2
node scripts/check-failsafe-reports.js non-hosted packages/sdk-java/runtime-broker packages/sdk-java/managed-agent-server > $O/5-guard-nonhosted.log 2>&1; S "MariaDB: Check that every non-Hosted integration test class ran" $?; tail -3 $O/5-guard-nonhosted.log
# --- job 'hosted-harness-mysql' (MySQL 8.4)
(cd packages/sdk-java/managed-agent-server && mvn --batch-mode --no-transfer-progress -Phosted-harness-mysql "-Dnode.executable=$(command -v node)" "-Dqwen.cli.entry=$CLI" "-Dmysql.url=jdbc:mysql://127.0.0.1:3306/hosted_harness_test_$L?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rootpw clean verify checkstyle:check > $O/6-hosted.log 2>&1); S "Hosted: Verify Hosted Java, Spring and MySQL processes" $?
sum $O/6-hosted.log | grep -E "IT$|IT |Tests run: [0-9]+, F|FAIL|ERROR" | head -20
node scripts/check-failsafe-reports.js hosted packages/sdk-java/managed-agent-server > $O/7-guard-hosted.log 2>&1; S "Hosted: Check that every Hosted integration test class ran" $?; tail -3 $O/7-guard-hosted.log
(mvn --batch-mode --no-transfer-progress -f packages/sdk-java/runtime-broker/pom.xml -Pfault-gates "-Dqwen.cli.entry=$CLI" test > $O/8-gates.log 2>&1); S "Hosted: Run Runtime Broker fault gates" $?
grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures' $O/8-gates.log | tail -1; grep -E '<<< (FAILURE|ERROR)!' $O/8-gates.log | head -5
echo "[$L] CI-REPLAY-DONE"
