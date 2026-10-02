#!/bin/bash
# usage: unit-gate.sh <worktree> <label>  -> full default managed-agent-server gate (clean verify checkstyle:check)
W=$1; L=$2; S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9d84bca0-c4ea-4895-80e3-553468b6983a/scratchpad; M=$S/rig/mvn.sh
cd $W || exit 2
echo "== $L $(git rev-parse HEAD) start $(date +%T)"
$M -o -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install -q || { echo "sdk install failed"; exit 3; }
$M -o -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install -q || { echo "broker install failed"; exit 3; }
$M -o -f packages/sdk-java/managed-agent-server/pom.xml clean verify checkstyle:check > $S/logs/unit-$L.log 2>&1; rc=$?
echo "== $L mvn exit=$rc end $(date +%T)"
grep -E "Tests run:.*Fail|BUILD|violation|ERROR\]" $S/logs/unit-$L.log | tail -8
