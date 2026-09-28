#!/bin/bash
# usage: build-arm.sh <arm>   builds wt-<arm>: TS build + bundle + Java jars, isolated Maven repo m2-<arm>
SCRATCH=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/bf547e10-456d-4aa7-8960-aef6c60a0195/scratchpad
ARM=$1
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
export JAVA_HOME=/Users/wenshao/Install/jdk21
cd $SCRATCH/wt-$ARM || exit 1
echo "arm=$ARM head=$(git rev-parse HEAD) start=$(date +%T)"
node scripts/setup-worktree.js > $SCRATCH/logs/setup-$ARM.log 2>&1; echo "setup rc=$?"
npm run build > $SCRATCH/logs/build-$ARM.log 2>&1; echo "build rc=$?"
npm run bundle > $SCRATCH/logs/bundle-$ARM.log 2>&1; echo "bundle rc=$?"
rm -rf $SCRATCH/m2-$ARM; cp -Rc ~/.m2/repository $SCRATCH/m2-$ARM
rm -rf $SCRATCH/m2-$ARM/com/alibaba/qwen-managed-runtime-broker $SCRATCH/m2-$ARM/com/alibaba/qwencode-sdk
MVN="/Users/wenshao/Install/maven/bin/mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$SCRATCH/m2-$ARM"
$MVN -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $SCRATCH/logs/mvn-sdk-$ARM.log 2>&1; echo "sdk rc=$?"
$MVN -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install > $SCRATCH/logs/mvn-broker-install-$ARM.log 2>&1; echo "broker rc=$?"
$MVN -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests package > $SCRATCH/logs/mvn-server-package-$ARM.log 2>&1; echo "server rc=$?"
cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $SCRATCH/jars/$ARM-server.jar
ls -la dist/cli.js $SCRATCH/jars/$ARM-server.jar
echo "head=$(git rev-parse HEAD) dirty=$(git status --short | wc -l | tr -d ' ') end=$(date +%T)"
