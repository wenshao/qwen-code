#!/bin/bash
# usage: run.sh <label> hosted|mariadb [extra mvn args...]  -- CI commands verbatim except DB ports/repo
set -uo pipefail
SP=${SCRATCH}
LABEL=$1; KIND=$2; shift 2
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
export MAVEN_ARGS="-s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo"
WT=$SP/wt; LOG=$SP/java/$LABEL.log
if [ "$KIND" = hosted ]; then
  docker exec pr12819-mysql mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS hosted_harness_test; CREATE DATABASE hosted_harness_test;" 2>/dev/null
  cd $WT && mvn --batch-mode --no-transfer-progress -f packages/sdk-java/managed-agent-server/pom.xml \
    -Phosted-harness-mysql "$@" -Dqwen.cli.entry="$WT/dist/cli.js" \
    -Dmysql.url="jdbc:mysql://127.0.0.1:33819/hosted_harness_test?allowPublicKeyRetrieval=true&useSSL=false" \
    -Dmysql.user=root -Dmysql.password=hosted-fixture verify checkstyle:check > $LOG 2>&1
else
  docker exec pr12819-mariadb mariadb -uroot -pruntime-broker -e "DROP DATABASE IF EXISTS managed_agent_test;" 2>/dev/null
  cd $WT/packages/sdk-java/managed-agent-server && mvn --batch-mode --no-transfer-progress -Pmysql-integration "$@" \
    -Dmysql.url='jdbc:mysql://127.0.0.1:33820/managed_agent_test?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false' \
    -Dmysql.user=root -Dmysql.password=runtime-broker clean verify checkstyle:check > $LOG 2>&1
fi
echo "$LABEL exit=$?"
grep -E "Running com\.|Tests run: [0-9]+, Fail.*Skipped: [0-9]+$|HOSTED_MYSQL_DATABASE|ROUTING_PROBE|BUILD (SUCCESS|FAILURE)|You have [0-9]+ Checkstyle|No tests to run|\[ERROR\] Failed" $LOG | sed -E 's/^\[INFO\] //' | cut -c1-200
