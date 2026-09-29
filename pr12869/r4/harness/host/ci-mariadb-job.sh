#!/bin/bash
# container: the 'mysql-integration' (MariaDB) job of sdk-java.yml, step by step, then its report guard.
# usage: ci-mariadb-job.sh <arm: head|renamed>
set -u
ARM=$1; TREE=src-v4; [ $ARM = renamed ] && TREE=src-v4-renamed
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/ci-$ARM; mkdir -p $O
W=/ci-$ARM; rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
cp -a /root/.m2/repository /m2; export MAVEN_ARGS="-Dmaven.repo.local=/m2"
cd $W
PORT=3307; PW=runtime-broker
(cd packages/sdk-java/qwencode && mvn --batch-mode --no-transfer-progress -q -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/mariadb-0-qwencode.log 2>&1)
(cd packages/sdk-java/runtime-broker && mvn --batch-mode --no-transfer-progress -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:$PORT/runtime_broker_test?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=$PW clean verify > $O/mariadb-1-broker.log 2>&1); echo "[$ARM] step 'Run Runtime Broker MySQL integration tests': exit=$?"
(mvn --batch-mode --no-transfer-progress -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install && mvn --batch-mode --no-transfer-progress -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install) > $O/mariadb-2-install.log 2>&1; echo "[$ARM] step 'Install Managed Agent dependencies': exit=$?"
(cd packages/sdk-java/managed-agent-server && mvn --batch-mode --no-transfer-progress -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:$PORT/managed_agent_test_$ARM?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=$PW clean verify checkstyle:check > $O/mariadb-3-server.log 2>&1); echo "[$ARM] step 'Run Managed Agent tests, Checkstyle, and MySQL integration': exit=$?"
grep -E "Tests run:.*-- in .*IT$" $O/mariadb-1-broker.log $O/mariadb-3-server.log | sed -E 's/^[^:]+:\[[A-Z]+\] //; s/, Time elapsed.*-- in / -- /'
node scripts/check-failsafe-reports.js non-hosted packages/sdk-java/runtime-broker packages/sdk-java/managed-agent-server > $O/mariadb-4-guard.log 2>&1; echo "[$ARM] step 'Check that every non-Hosted integration test class ran': exit=$?"
cat $O/mariadb-4-guard.log
echo "[$ARM] MARIADB-JOB-DONE"
