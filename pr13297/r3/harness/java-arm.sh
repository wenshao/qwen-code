#!/bin/bash
# usage: java-arm.sh <arm> <m2dir> [mas]
set -u
arm=$1; m2=$2; mas=${3:-}
S=$(dirname "$0")
export JAVA_HOME=$HOME/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
cd /Users/wenshao/git/qwen-code-pr13297-$arm || exit 1
M=(mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$m2)
{ "${M[@]}" -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install && "${M[@]}" -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install; echo "install rc=$?"; } > $S/java-$arm-install.log 2>&1
{ "${M[@]}" -f packages/sdk-java/runtime-broker/pom.xml clean test checkstyle:check; echo "broker test rc=$?"; } > $S/java-$arm-broker-test.log 2>&1
"${M[@]}" -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install >> $S/java-$arm-install.log 2>&1
if [ "$mas" = mas ]; then
  { "${M[@]}" -f packages/sdk-java/managed-agent-server/pom.xml clean test; echo "mas test rc=$?"; } > $S/java-$arm-mas-test.log 2>&1
fi
