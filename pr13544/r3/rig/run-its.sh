#!/bin/bash
# usage: run-its.sh <arm> <engine>
A=$1; E=$2; RIG=/Users/wenshao/pr13544-rig; W=$RIG/src-$A/packages/sdk-java/managed-agent-server; L=$RIG/out/it-$A-$E${ITTAG:-}.log
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
if [ $E = mysql ]; then PORT=13544; PW=; else PORT=13545; PW=$(cat $RIG/mariadb.pw); fi
echo "=== $(date +%T) $A ITs on $E ($(git -C $RIG/src-$A rev-parse --short HEAD))" > $L
(cd $W && /Users/wenshao/Install/maven/bin/mvn -B -ntp -Dmaven.repo.local=$RIG/m2-$A -Dcheckstyle.skip=true -Dspotbugs.skip=true -Pmysql-integration -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:$PORT/${ITDB:-managed_agent_test}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root "-Dmysql.password=$PW" verify) >> $L 2>&1
echo "[$A $E] exit=$?" >> $L
echo "=== $(date +%T) IT-DONE" >> $L
