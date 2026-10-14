#!/bin/bash
# Replays the CI "Runtime Broker and Managed Agent MariaDB" lane locally for src-r3m
# (695fcf592e + #14177's catalog fix and broker IT isolation), ITs only (unit tests run green in CI's ubuntu lane).
set -u
RIG=/Users/wenshao/pr13918-rig; W=$RIG/src-r3m/packages/sdk-java; M2=$RIG/m2-r3m; L=$RIG/out/it-r3m-mariadb.log
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN=/Users/wenshao/Install/maven/bin/mvn
[ -d $M2 ] || { cp -Rc ~/.m2/repository $M2 && rm -rf $M2/com/alibaba/qwencode-sdk $M2/com/alibaba/qwen-managed-runtime-broker $M2/com/alibaba/qwen-managed-agent-server; }
R="-Dmaven.repo.local=$M2"
URL="jdbc:mysql://127.0.0.1:23920"
echo "=== $(date +%T) r3m ($(git -C $W rev-parse --short HEAD)) MariaDB $(docker exec pr13918-r3-mariadb sh -c 'MYSQL_PWD=runtime-broker mariadb -uroot -N -e "SELECT VERSION()"')" > $L
(cd $W/qwencode && $MVN -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install) >> $L 2>&1; echo "qwencode install exit=$?" >> $L
echo "=== $(date +%T) broker ITs" >> $L
(cd $W/runtime-broker && $MVN -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean install) >> $L 2>&1; echo "broker install exit=$?" >> $L
(cd $W/runtime-broker && $MVN -B -ntp $R -Pmysql-integration -Dcheckstyle.skip=true -Dspotbugs.skip=true test-compile failsafe:integration-test failsafe:verify \
  "-Dmysql.url=$URL/runtime_broker_test?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=runtime-broker) >> $L 2>&1; echo "BROKER-IT exit=$?" >> $L
echo "=== $(date +%T) managed-agent ITs" >> $L
(cd $W/managed-agent-server && $MVN -B -ntp $R -Pmysql-integration -Dcheckstyle.skip=true -Dspotbugs.skip=true clean test-compile failsafe:integration-test failsafe:verify \
  "-Dmysql.url=$URL/managed_agent_test?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=runtime-broker) >> $L 2>&1; echo "MANAGED-IT exit=$?" >> $L
echo "=== $(date +%T) IT-MARIADB-DONE" >> $L
