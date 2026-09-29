#!/bin/bash
# container: fault gates only, from a local-disk copy of a tree (dist included). usage: gates-local.sh <tree> <label>
set -u
TREE=$1; L=$2
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/gates; mkdir -p $O
W=/g-$L; rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
cp -a /root/.m2/repository /m2; export MAVEN_ARGS="-Dmaven.repo.local=/m2"
cd $W
(mvn --batch-mode --no-transfer-progress -q -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install) > /dev/null 2>&1
mvn --batch-mode --no-transfer-progress -f packages/sdk-java/runtime-broker/pom.xml -Pfault-gates "-Dqwen.cli.entry=$W/dist/cli.js" test > $O/$L.log 2>&1; echo "[$L] fault gates (local-disk copy): exit=$?"
grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures' $O/$L.log | tail -1; grep -E '<<< (FAILURE|ERROR)!' $O/$L.log | head -5
