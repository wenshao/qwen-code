#!/bin/bash
# G1 (round 5): the CI MariaDB lane's command on the trial-merge clone. Unit failures are recorded, not fatal,
# so a load-induced surefire flake cannot stop failsafe from running the ITs (round-4 trap).
R=/Users/wenshao/pr13554-rig; L=$R/r5/results/gates; mkdir -p $L
REPO="-Dmaven.repo.local=$R/m2-x5 -Dmaven.repo.local.tail=/m2tail"
cd $R/g1-5/packages/sdk-java/managed-agent-server
mysql -hmariadb -uroot -pverify -e 'DROP DATABASE IF EXISTS managed_agent_test' 2>/dev/null
start=$(date +%s)
mvn -B -o $REPO -Pmysql-integration -Dmaven.test.failure.ignore=true -Dmysql.url='jdbc:mysql://mariadb:3306/managed_agent_test?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false' -Dmysql.user=root -Dmysql.password=verify clean verify checkstyle:check > $L/G1-mariadb-verify.log 2>&1
echo "exit=$? secs=$(( $(date +%s) - start ))" >> $L/G1-mariadb-verify.log
cd $R/g1-5 && node scripts/check-failsafe-reports.js non-hosted packages/sdk-java/managed-agent-server >> $L/G1-mariadb-verify.log 2>&1; echo "failsafe-check exit=$?" >> $L/G1-mariadb-verify.log
echo G1-DONE >> $L/G1-mariadb-verify.log
