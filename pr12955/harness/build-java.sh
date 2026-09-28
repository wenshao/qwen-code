#!/bin/bash
# usage: build-java.sh <wt> <tag>
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad
WT=$SP/$1; TAG=$2
cd $WT
export JAVA_HOME=~/Install/jdk21 PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:~/Install/jdk21/bin:~/Install/maven/bin:$PATH
A="--batch-mode --no-transfer-progress -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo-$TAG"
mvn $A -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $SP/logs/$TAG-mvn-qwencode.log 2>&1 || echo FAIL qwencode
mvn $A -f packages/sdk-java/runtime-broker/pom.xml -Dgpg.skip=true -DskipTests install > $SP/logs/$TAG-mvn-broker.log 2>&1; echo "broker install rc=$?"
mvn $A -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests -Dcheckstyle.skip clean package > $SP/logs/$TAG-mvn-package.log 2>&1 && cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-*.jar $SP/jars/$TAG-server.jar && echo "jar ok"
echo BUILD_DONE
