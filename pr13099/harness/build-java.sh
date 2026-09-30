#!/bin/bash
# usage: build-java.sh <wt> <tag>   (VERIFICATION RIG ONLY)
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad
WT=$SP/$1; TAG=$2
cd $WT || exit 1
export JAVA_HOME=$HOME/Install/jdk21 PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$HOME/Install/jdk21/bin:$HOME/Install/maven/bin:$PATH
A="--batch-mode --no-transfer-progress -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo"
echo "HEAD=$(git rev-parse HEAD) dirty=$(git status --short | wc -l | tr -d ' ')"
mvn $A -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $SP/logs/$TAG-mvn-qwencode.log 2>&1; echo "qwencode install rc=$?"
mvn $A -f packages/sdk-java/runtime-broker/pom.xml -Dgpg.skip=true -DskipTests install > $SP/logs/$TAG-mvn-broker.log 2>&1; echo "broker install rc=$?"
mvn $A -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests -Dcheckstyle.skip clean package > $SP/logs/$TAG-mvn-package.log 2>&1; echo "server package rc=$?"
cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $SP/jars/$TAG-server.jar && echo "jar ok $(ls -la $SP/jars/$TAG-server.jar | awk '{print $5}')"
echo BUILD_DONE
