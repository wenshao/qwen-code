#!/bin/bash
# usage: it.sh <arm> <mariadb|mysql> <ITpattern> <tag> [extra mvn args]
S=$SCRATCH
ARM=$1; DB=$2; PAT=$3; TAG=$4; shift 4
M2=$S/m2-${M2ARM:-$ARM}
case $DB in mariadb) PORT=24178;; mysql) PORT=24179;; esac
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH
cd $S/wt-$ARM/packages/sdk-java/managed-agent-server
LOG=$S/logs/it-$TAG-$ARM-$DB.log
mvn -o -B -ntp -Dmaven.repo.local=$M2 -Pmysql-integration \
  -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/managed_agent_test?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=runtime-broker -Dit.test="$PAT" -Dspotbugs.skip=true -Dcheckstyle.skip=true \
  -Dfailsafe.failIfNoSpecifiedTests=false "$@" test-compile failsafe:integration-test failsafe:verify > $LOG 2>&1
echo "EXIT=$? $TAG $ARM $DB"; grep -E "Tests run:.*Fail|PROBE|BUILD" $LOG | tail -40
