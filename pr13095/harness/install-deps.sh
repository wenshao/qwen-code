#!/bin/bash
# The CI step "Install Managed Agent dependencies", into a private m2. usage: install-deps.sh <worktree> <m2 dir>
set -u
. /Users/wenshao/pr13095-rig/scripts/env.sh
W=$RIG/$1; M2=$RIG/$2; L=$1
R="-Dmaven.repo.local=$M2"
mvn --batch-mode --no-transfer-progress $R -f $W/packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $RIG/out/install-$L.log 2>&1; echo "[$L] qwencode install exit=$?"
mvn --batch-mode --no-transfer-progress $R -f $W/packages/sdk-java/runtime-broker/pom.xml -DskipTests install >> $RIG/out/install-$L.log 2>&1; echo "[$L] runtime-broker install exit=$?"
echo "[$L] $(java -version 2>&1 | head -1) | $(mvn -v | head -1)"
