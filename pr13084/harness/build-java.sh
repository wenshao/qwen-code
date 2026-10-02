#!/bin/bash
# usage: build-java.sh <worktree> <jar label>   (serial only: arms share one m2)
set -e
W=$1; LABEL=$2; M=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/rig/mvn.sh
cd $W
echo "== java build $LABEL $(git rev-parse --short HEAD) $(date +%T)"
$M ${MVN_OFFLINE--o} -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true clean install -q
$M ${MVN_OFFLINE--o} -f packages/sdk-java/runtime-broker/pom.xml -DskipTests clean install -q
$M ${MVN_OFFLINE--o} -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests clean package -q
cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/jars/$LABEL-server.jar
ls -la /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/jars/$LABEL-server.jar
echo "== done $LABEL $(date +%T)"
