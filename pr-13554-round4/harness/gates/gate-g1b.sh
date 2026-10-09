#!/bin/bash
# G1b: the MariaDB-lane integration tests only (unit tests already covered), on the trial-merge clone.
R=/Users/wenshao/pr13554-rig; L=$R/logs/gates4; mkdir -p $L
REPO="-Dmaven.repo.local=$R/m2-m4 -Dmaven.repo.local.tail=/m2tail"
cd $R/g1/packages/sdk-java/managed-agent-server
mysql -hmariadb -uroot -pverify -e 'DROP DATABASE IF EXISTS managed_agent_test' 2>/dev/null
start=$(date +%s)
mvn -B -o $REPO -Pmysql-integration -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dmysql.url='jdbc:mysql://mariadb:3306/managed_agent_test?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false' -Dmysql.user=root -Dmysql.password=verify verify checkstyle:check > $L/G1b-mariadb-its.log 2>&1
echo "exit=$? secs=$(( $(date +%s) - start ))" >> $L/G1b-mariadb-its.log
cd /Users/wenshao/pr13554-rig/g1 && node scripts/check-failsafe-reports.js non-hosted packages/sdk-java/managed-agent-server >> $L/G1b-mariadb-its.log 2>&1; echo "failsafe-check exit=$?" >> $L/G1b-mariadb-its.log
echo G1B-DONE >> $L/G1b-mariadb-its.log
