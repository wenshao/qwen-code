#!/bin/bash
# usage: [TAG=..] run-race5.sh <db: mysql84|mariadb> <scenarios> [rounds]   (round-4 RecoveryRaceProbe on the trial-merge arm)
DB=$1; SC=$2; ROUNDS=${3:-30}
R=/Users/wenshao/pr13554-rig; L=$R/r5/results/race; mkdir -p $L
cd $R/race-x5/packages/sdk-java/managed-agent-server
mysql -h$DB -uroot -pverify -e 'CREATE DATABASE IF NOT EXISTS race_root' 2>/dev/null
timeout 1800 mvn -B -o -Dmaven.repo.local=$R/m2-x5 -Dmaven.repo.local.tail=/m2tail -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true \
  -Dtest=RecoveryRaceProbe -Dsurefire.failIfNoSpecifiedTests=false -Dprobe.arm=head5 -Dprobe.db=$DB -Dprobe.scenarios=$SC -Dprobe.rounds=$ROUNDS \
  -Dmysql.url="jdbc:mysql://$DB:3306/race_root?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=verify \
  test > $L/head5-$DB-${SC//,/_}${TAG:-}.log 2>&1
echo "exit=$?" >> $L/head5-$DB-${SC//,/_}${TAG:-}.log
grep -h "^RESULT" $L/head5-$DB-${SC//,/_}${TAG:-}.log
