#!/bin/bash
S=$SCRATCH
ARM=$1; DB=$2; M2=$S/m2-${M2ARM:-$ARM}
case $DB in mariadb) PORT=24178; C=pr14178-mariadb; CLI=mariadb;; mysql) PORT=24179; C=pr14178-mysql; CLI=mysql;; esac
docker --context colima exec $C $CLI -uroot -pruntime-broker -e "DROP DATABASE IF EXISTS runtime_broker_test; CREATE DATABASE runtime_broker_test" 2>/dev/null
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH
cd $S/wt-$ARM/packages/sdk-java/runtime-broker
mvn -o -B -ntp -Dmaven.repo.local=$M2 -Pmysql-integration -Dspotbugs.skip=true \
  -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/runtime_broker_test?allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=runtime-broker clean verify > $S/logs/broker-$ARM-$DB.log 2>&1
echo "BROKER_EXIT=$? $ARM $DB" >> $S/logs/broker-$ARM-$DB.log
