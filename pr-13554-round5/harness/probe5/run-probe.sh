#!/bin/bash
# usage: run-probe.sh <arm-dir> <m2> <test> <db> <tag>  (inside the rig container)
ARM=$1; M2=$2; TEST=$3; DB=$4; TAG=$5
R=/Users/wenshao/pr13554-rig; L=$R/r5/results/probe; mkdir -p $L
cd $R/$ARM/packages/sdk-java/managed-agent-server
mysql -h$DB -uroot -pverify -e 'CREATE DATABASE IF NOT EXISTS probe_root' 2>/dev/null
G=$R/r5/mig
timeout 1800 mvn -B -o -Dmaven.repo.local=$R/$M2 -Dmaven.repo.local.tail=/m2tail -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true \
  -Dtest=$TEST -Dsurefire.failIfNoSpecifiedTests=false -Dprobe.db=$DB \
  -Dprobe.mig.main=$G/main -Dprobe.mig.head=$G/head -Dprobe.mig.v58=$G/v58 -Dprobe.mig.main66=$G/main66 -Dprobe.mig.head66=$G/head66 \
  -Dmysql.url="jdbc:mysql://$DB:3306/probe_root?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=verify \
  test > $L/$TAG-$DB.log 2>&1
echo "exit=$?" >> $L/$TAG-$DB.log
grep -hE "^(RESULT|PROBE)" $L/$TAG-$DB.log
