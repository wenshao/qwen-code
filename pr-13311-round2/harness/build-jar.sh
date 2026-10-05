#!/bin/bash
# Build the Spring jar from <armdir> with a private local repo (read-through tail on ~/.m2), offline.
set -o pipefail
W="$1"; R=/root/verify/pr13311/m2
export JAVA_HOME=/usr/local/jdk21 PATH=/usr/local/jdk21/bin:$PATH
M="/root/Install/maven/bin/mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$R -Dmaven.repo.local.tail=/root/.m2/repository"
start=$(date +%s)
$M -f $W/packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > jar-qwencode.log 2>&1 || { echo "QWENCODE_FAIL"; exit 1; }
$M -f $W/packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install > jar-broker.log 2>&1 || { echo "BROKER_FAIL"; exit 1; }
$M -f $W/packages/sdk-java/managed-agent-server/pom.xml -DskipTests -Dspotbugs.skip=true -Dcheckstyle.skip=true package > jar-server.log 2>&1 || { echo "SERVER_FAIL"; exit 1; }
ls -la $W/packages/sdk-java/managed-agent-server/target/*.jar
echo "JAR_OK $(( $(date +%s)-start ))s"
