#!/bin/bash
# itm.sh <src-arm> <m2-arm> <tag> <it.test> — managed-agent ITs on the private MariaDB (23920)
SRC=$1; M2A=$2; TAG=$3; ITS=$4; RIG=/Users/wenshao/pr13918-rig; L=$RIG/out/itm-$TAG.log
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
cd $RIG/src-$SRC/packages/sdk-java/managed-agent-server
echo "=== $(date +%T) ITM $TAG src=$SRC ($(git rev-parse --short HEAD)) its=$ITS" > $L
/Users/wenshao/Install/maven/bin/mvn -B -ntp -Dmaven.repo.local=$RIG/m2-$M2A -Pmysql-integration -Dcheckstyle.skip=true -Dspotbugs.skip=true \
  test-compile failsafe:integration-test failsafe:verify -Dit.test="$ITS" -Dfailsafe.failIfNoSpecifiedTests=false \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:23920/managed_agent_test?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=runtime-broker >> $L 2>&1
echo "[$TAG] EXIT=$?" >> $L
echo "[$TAG] $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $L | tail -1) $(grep -E '<<< (FAILURE|ERROR)!$' $L | sed 's/ -- Time.*//' | tr '\n' ' ')"
