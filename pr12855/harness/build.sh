#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f6f165f1-2767-4012-bf7c-2c22899a4751/scratchpad
WT=$SP/${1:-wt-pr}; TAG=${2:-pr}
cd $WT
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$PATH
A="--batch-mode --no-transfer-progress -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo"
mvn $A -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $SP/logs/$TAG-mvn-qwencode.log 2>&1 || echo FAIL qwencode
mvn $A -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dgpg.skip=true install > $SP/logs/$TAG-mvn-broker.log 2>&1; echo "broker install rc=$?"
mvn $A -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests -Dcheckstyle.skip package > $SP/logs/$TAG-mvn-package.log 2>&1 && cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-*.jar $SP/jars/$TAG-server.jar && echo "jar ok"
echo JAVA_DONE
