#!/bin/bash
# container: why the broker step of the second arm failed. JdbcRuntimeBrokerMySqlIT runs the repository contract
# with the fixed prefix "mysql", so a database that an earlier run already used is not a valid target.
# CI starts a fresh MariaDB service for every job. usage: ci-mariadb-control.sh <label>
set -u
LABEL=$1
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/ci-control; mkdir -p $O
W=/ci-control; rm -rf $W && mkdir -p $W && cp -a /rig/src-v4/. $W/
cp -a /root/.m2/repository /m2; export MAVEN_ARGS="-Dmaven.repo.local=/m2"
cd $W
(cd packages/sdk-java/qwencode && mvn --batch-mode --no-transfer-progress -q -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/$LABEL-0-qwencode.log 2>&1)
(cd packages/sdk-java/runtime-broker && mvn --batch-mode --no-transfer-progress -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:3307/runtime_broker_test?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=runtime-broker clean verify > $O/$LABEL-1-broker.log 2>&1); echo "[head, $LABEL] step 'Run Runtime Broker MySQL integration tests': exit=$?"
grep -E "Tests run:.*-- in .*IT$" $O/$LABEL-1-broker.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed.*-- in / -- /'
grep -E "^\[ERROR\]   " $O/$LABEL-1-broker.log | sed 's/^\[ERROR\] *//'
echo "[head, $LABEL] CONTROL-DONE"
