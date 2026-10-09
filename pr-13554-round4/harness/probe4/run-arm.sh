#!/bin/bash
# usage: run-arm.sh <arm> <db: mysql84|mariadb> <scenarios> [rounds]
ARM=$1; DB=$2; SC=$3; ROUNDS=${4:-30}
R=/Users/wenshao/pr13554-rig; L=$R/logs/race; mkdir -p $L
cd $R/arm-$ARM/packages/sdk-java/managed-agent-server
mysql -h$DB -uroot -pverify -e 'CREATE DATABASE IF NOT EXISTS race_root' 2>/dev/null
timeout 1800 mvn -B -o -Dmaven.repo.local=$R/m2-h4 -Dmaven.repo.local.tail=/m2tail -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true \
  -Dtest=RecoveryRaceProbe -Dsurefire.failIfNoSpecifiedTests=false -Dprobe.arm=$ARM -Dprobe.db=$DB -Dprobe.scenarios=$SC -Dprobe.rounds=$ROUNDS \
  -Dmysql.url="jdbc:mysql://$DB:3306/race_root?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=verify \
  test > $L/$ARM-$DB-${SC//,/_}${TAG:-}.log 2>&1
echo "exit=$?" >> $L/$ARM-$DB-${SC//,/_}${TAG:-}.log
grep -h "^RESULT" $L/$ARM-$DB-${SC//,/_}${TAG:-}.log
