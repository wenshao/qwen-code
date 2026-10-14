#!/bin/bash
# full non-Hosted managed IT lane: lane.sh <arm> <db> <tag>
S=$SCRATCH
ARM=$1; DB=$2; TAG=$3; M2=$S/m2-${M2ARM:-$ARM}
case $DB in mariadb) PORT=24178; C=pr14178-mariadb; CLI=mariadb;; mysql) PORT=24179; C=pr14178-mysql; CLI=mysql;; esac
docker --context colima exec $C $CLI -uroot -pruntime-broker -e "DROP DATABASE IF EXISTS managed_agent_test" 2>/dev/null
export TZ=UTC JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH
cd $S/wt-$ARM/packages/sdk-java/managed-agent-server
mvn -o -B -ntp -Dmaven.repo.local=$M2 -Pmysql-integration -Dspotbugs.skip=true -Dcheckstyle.skip=true -Dprobe.rounds=20 \
  -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/managed_agent_test?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=runtime-broker test-compile failsafe:integration-test failsafe:verify > $S/logs/lane-$TAG-$ARM-$DB.log 2>&1
echo "LANE_EXIT=$? $ARM $DB" >> $S/logs/lane-$TAG-$ARM-$DB.log
