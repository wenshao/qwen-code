#!/bin/bash
# CI's MariaDB lane replayed for src-r4j (72a7897843 + #14177's 43f7d42817 catalog fix + 688ccb347f broker IT isolation), ITs only.
set -u
RIG=/Users/wenshao/pr13918-rig; W=$RIG/src-r4j/packages/sdk-java; R="-Dmaven.repo.local=$RIG/m2-r4j"; L=$RIG/out/it-r4j-mariadb.log
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH; MVN=/Users/wenshao/Install/maven/bin/mvn
URL="jdbc:mysql://127.0.0.1:23920"
echo "=== $(date +%T) r4j ($(git -C $W rev-parse --short HEAD)) MariaDB" > $L
(cd $W/runtime-broker && $MVN -B -ntp $R -Pmysql-integration -Dcheckstyle.skip=true -Dspotbugs.skip=true test-compile failsafe:integration-test failsafe:verify \
  "-Dmysql.url=$URL/runtime_broker_test?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=runtime-broker) >> $L 2>&1; echo "BROKER-IT exit=$?" >> $L
echo "=== $(date +%T) managed-agent ITs" >> $L
(cd $W/managed-agent-server && $MVN -B -ntp $R -Pmysql-integration -Dcheckstyle.skip=true -Dspotbugs.skip=true clean test-compile failsafe:integration-test failsafe:verify \
  "-Dmysql.url=$URL/managed_agent_test?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=runtime-broker) >> $L 2>&1; echo "MANAGED-IT exit=$?" >> $L
echo "=== $(date +%T) IT-MARIADB4-DONE" >> $L
