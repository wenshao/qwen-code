#!/bin/bash
# usage: build-arm.sh <arm>   builds wt-<arm>: TS build + bundle + Java jars, isolated Maven repo m2-<arm>
SCRATCH=/rig-home
ARM=$1
export PATH=/opt/node-22.23.2/bin:$PATH
export JAVA_HOME=/opt/jdk21
cd $SCRATCH/wt-$ARM || exit 1
echo "arm=$ARM head=$(git rev-parse HEAD) start=$(date +%T)"
node scripts/setup-worktree.js > $SCRATCH/logs/setup-$ARM.log 2>&1; echo "setup rc=$?"
npm run build > $SCRATCH/logs/build-$ARM.log 2>&1; echo "build rc=$?"
npm run bundle > $SCRATCH/logs/bundle-$ARM.log 2>&1; echo "bundle rc=$?"
# The clone is made once; mvn install overwrites the two project artifacts in it.
if [ ! -d $SCRATCH/m2-$ARM ]; then cp -Rc ~/.m2/repository $SCRATCH/m2-$ARM; fi
MVN="/opt/maven/bin/mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$SCRATCH/m2-$ARM"
$MVN -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $SCRATCH/logs/mvn-sdk-$ARM.log 2>&1; echo "sdk rc=$?"
$MVN -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install > $SCRATCH/logs/mvn-broker-install-$ARM.log 2>&1; echo "broker rc=$?"
$MVN -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests clean package > $SCRATCH/logs/mvn-server-package-$ARM.log 2>&1; echo "server rc=$?"
cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $SCRATCH/jars/$ARM-server.jar
ls -la dist/cli.js $SCRATCH/jars/$ARM-server.jar
echo "head=$(git rev-parse HEAD) dirty=$(git status --short | wc -l | tr -d ' ') end=$(date +%T)"
