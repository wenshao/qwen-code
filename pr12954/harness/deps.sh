#!/bin/bash
# usage: deps.sh [worktree] [m2]   -- install qwencode + runtime-broker SNAPSHOTs into the private m2
source /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/5f811a9d-a146-46e4-8a2e-161614683807/scratchpad/rig/env.sh
WT=${1:-wt-pr}; M2=${2:-m2}
cd $SP/$WT
mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$SP/$M2 -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $SP/logs/deps-$WT-qwencode.log 2>&1 || { echo qwencode failed; exit 1; }
mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$SP/$M2 -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install > $SP/logs/deps-$WT-broker.log 2>&1 || { echo broker failed; exit 1; }
echo "deps ok $WT -> $M2"
