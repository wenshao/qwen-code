#!/bin/bash
# inside container on pr12964net: run-it2.sh <tree> <label> <module> <jdbc-host> <db> <password>
TREE=$1; LABEL=$2; MOD=$3; HOST=$4; DB=$5; PW=$6
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
rm -rf /work && mkdir -p /work && cp -a /rig/$TREE/. /work/
cd /work/packages/sdk-java/qwencode && mvn -o -B -ntp -q -DskipTests -Dgpg.skip=true install > /dev/null 2>&1
cd /work/packages/sdk-java/runtime-broker && mvn -o -B -ntp -q -DskipTests install > /dev/null 2>&1
cd /work/packages/sdk-java/$MOD
mvn -B -ntp -Pmysql-integration -Dmaven.test.failure.ignore=true "-Dmysql.url=jdbc:mysql://$HOST:3306/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=$PW verify > /rig/out/$LABEL.log 2>&1; rc=$?
echo "$LABEL exit=$rc"; grep -E "Tests run:.*in com.*IT$|^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$" /rig/out/$LABEL.log | tail -6
grep -E "^\[ERROR\]   [A-Za-z]" /rig/out/$LABEL.log | head -6
