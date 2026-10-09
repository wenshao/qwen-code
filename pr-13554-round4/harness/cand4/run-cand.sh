#!/bin/bash
# usage: run-cand.sh <arm: head|plain|nofence> <db>   (inside the rig container)
A=$1; DB=$2; R=/Users/wenshao/pr13554-rig; L=$R/logs/cand4; mkdir -p $L
cd $R/cand4-$A/packages/sdk-java/managed-agent-server
mysql -h$DB -uroot -pverify -e 'CREATE DATABASE IF NOT EXISTS cand_root' 2>/dev/null
timeout 1800 mvn -B -o -Dmaven.repo.local=$R/m2-h4 -Dmaven.repo.local.tail=/m2tail -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true \
  -Dtest=SessionResourceCollectionMySqlIT -Dsurefire.failIfNoSpecifiedTests=false \
  -Dmysql.url="jdbc:mysql://$DB:3306/cand_root?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=verify \
  test > $L/$A-$DB.log 2>&1
echo "exit=$?" >> $L/$A-$DB.log
echo "$A $DB: $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $L/$A-$DB.log | tail -1) $(grep -E '^\[ERROR\] +SessionResourceCollection[A-Za-z]+\.[a-zA-Z]+' $L/$A-$DB.log | sed -E 's/^\[ERROR\] +//' | cut -c1-160 | sort -u | tr '\n' ' ')"
