#!/bin/bash
# usage: build-java.sh <worktree-dir-name> <tag> [skipTests]
SP=$SP
WT=$SP/$1; TAG=$2; SKIP=$3
cd $WT || exit 1
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$PATH
A="--batch-mode --no-transfer-progress -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2"
mvn $A -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $SP/logs/$TAG-mvn-qwencode.log 2>&1 || echo FAIL qwencode
mvn $A -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dgpg.skip=true install > $SP/logs/$TAG-mvn-broker.log 2>&1 || echo FAIL broker
if [ -z "$SKIP" ]; then
  mvn $A -f packages/sdk-java/managed-agent-server/pom.xml clean test checkstyle:check > $SP/logs/$TAG-mvn-mas-test.log 2>&1; echo "managed-agent-server clean test+checkstyle rc=$?"; grep -E "Tests run:.*Fail" $SP/logs/$TAG-mvn-mas-test.log | tail -1
fi
mvn $A -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests -Dcheckstyle.skip package > $SP/logs/$TAG-mvn-package.log 2>&1 && cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-*.jar $SP/jars/$TAG-server.jar && echo "jar ok"
echo BUILD_DONE
