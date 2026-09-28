#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/a3d8cbe6-83a8-459a-99a4-f6d43fbc9c27/scratchpad
WT=$SP/$1; TAG=$2
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$PATH
A="--batch-mode --no-transfer-progress -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo"
cd $WT && mvn $A -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests -Dcheckstyle.skip package > $SP/logs/$TAG-mvn-package.log 2>&1 && cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-*.jar $SP/jars/$TAG-server.jar && echo "$TAG jar ok" || { echo "$TAG package FAILED"; grep -E "ERROR" $SP/logs/$TAG-mvn-package.log | head -5; }
