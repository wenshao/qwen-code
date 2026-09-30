#!/bin/bash
# Install qwencode + runtime-broker from <worktree> into <m2>, as the CI job does before managed-agent-server.
# usage: install-deps.sh <worktree> <m2 dir name>
set -u
. /Users/wenshao/pr13116-rig/scripts/env.sh
W=$RIG/$1; M=$RIG/$2
mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$M -f $W/packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $RIG/logs/install-$1-qwencode.log 2>&1; A=$?
mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$M -f $W/packages/sdk-java/runtime-broker/pom.xml -DskipTests install > $RIG/logs/install-$1-broker.log 2>&1; B=$?
echo "RESULT install $1 -> $2 qwencode=$A broker=$B"
