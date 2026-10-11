#!/bin/bash
# usage: run-it.sh <arm-dir> <m2> <test-selector> <db> <tag> [extra mvn args]   (surefire-run of an IT class, inside the rig container)
ARM=$1; M2=$2; TEST=$3; DB=$4; TAG=$5; EXTRA=${6:-}
R=/Users/wenshao/pr13554-rig; L=$R/r5/results/it; mkdir -p $L
cd $R/$ARM/packages/sdk-java/managed-agent-server
mysql -h$DB -uroot -pverify -e 'CREATE DATABASE IF NOT EXISTS it_root' 2>/dev/null
s=$(date +%s)
timeout 1800 mvn -B -o -Dmaven.repo.local=$R/$M2 -Dmaven.repo.local.tail=/m2tail -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true \
  -Dtest="$TEST" -Dsurefire.failIfNoSpecifiedTests=false \
  -Dmysql.url="jdbc:mysql://$DB:3306/it_root?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=verify \
  $EXTRA test > $L/$TAG-$DB.log 2>&1
echo "exit=$? secs=$(( $(date +%s) - s ))" >> $L/$TAG-$DB.log
grep -hE "Tests run:|FAIL|exit=" $L/$TAG-$DB.log | grep -v "^\[INFO\] Tests run: [0-9]*, Failures: 0, Errors: 0, Skipped: 0$" | tail -6
