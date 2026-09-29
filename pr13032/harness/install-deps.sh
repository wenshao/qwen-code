#!/bin/bash
# usage: install-deps.sh <worktree> <m2repo> <log>
set -e
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH=$JAVA_HOME/bin:$PATH
W=$1; R=$2; L=$3
{
java -version 2>&1 | head -1
mvn -B -ntp -o -Dmaven.repo.local=$R -f $W/packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install -q
echo qwencode-ok
mvn -B -ntp -o -Dmaven.repo.local=$R -f $W/packages/sdk-java/runtime-broker/pom.xml -DskipTests install -q
echo runtime-broker-ok
} > $L 2>&1
