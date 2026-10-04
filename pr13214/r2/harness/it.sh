#!/bin/bash
arm=$1; wt=$2
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH; export TZ=UTC
cd $wt/packages/sdk-java/runtime-broker
mvn -o -B -Dmaven.repo.local=/Users/wenshao/pr13214-rig/m2-$arm -Pmysql-integration -Duser.timezone=UTC \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:33214/it_${arm}_${IT_DB_SUFFIX:-1}?allowPublicKeyRetrieval=true&useSSL=false&createDatabaseIfNotExist=true" \
  -Dmysql.user=root -DskipTests=false -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false \
  test-compile failsafe:integration-test failsafe:verify > /Users/wenshao/pr13214-rig/logs/$arm-it.log 2>&1
echo "it=$?" > /Users/wenshao/pr13214-rig/logs/$arm-it.status
