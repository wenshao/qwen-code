#!/bin/bash
# usage: build-java.sh <worktree> <jar label>
set -e
W=$1; LABEL=$2
M=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9d84bca0-c4ea-4895-80e3-553468b6983a/scratchpad/rig/mvn.sh
cd $W
echo "== java build $LABEL $(git rev-parse --short HEAD) $(date +%T)"
$M -o -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true clean install -q
$M -o -f packages/sdk-java/runtime-broker/pom.xml -DskipTests clean install -q
$M -o -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests clean package -q
cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9d84bca0-c4ea-4895-80e3-553468b6983a/scratchpad/rig/jars/$LABEL-server.jar
ls -la /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9d84bca0-c4ea-4895-80e3-553468b6983a/scratchpad/rig/jars/$LABEL-server.jar
echo "== done $LABEL $(date +%T)"
