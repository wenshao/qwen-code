#!/bin/bash
R=/Users/wenshao/pr13554-rig; L=$R/logs/gates; mkdir -p $L
REPO="-Dmaven.repo.local=$R/m2-head -Dmaven.repo.local.tail=/m2tail"
cd $R/g1/packages/sdk-java/managed-agent-server
start=$(date +%s)
mvn -B -o $REPO -Pmysql-integration -Dmysql.url='jdbc:mysql://mariadb:3306/managed_agent_test?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false' -Dmysql.user=root -Dmysql.password=verify clean verify checkstyle:check > $L/G1-mariadb-verify.log 2>&1
echo "exit=$? secs=$(( $(date +%s) - start ))" >> $L/G1-mariadb-verify.log
echo G1-DONE >> $L/G1-mariadb-verify.log
