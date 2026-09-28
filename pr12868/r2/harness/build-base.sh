#!/bin/bash
# Builds the merge-base arm (TS build + bundle + Java jars) with its own Maven repository.
SCRATCH=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/bf547e10-456d-4aa7-8960-aef6c60a0195/scratchpad
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
export JAVA_HOME=/Users/wenshao/Install/jdk21
cd $SCRATCH/wt-base || exit 1
git rev-parse HEAD
node scripts/setup-worktree.js > $SCRATCH/logs/setup-base.log 2>&1; echo "setup rc=$?"
npm run build > $SCRATCH/logs/build-base.log 2>&1; echo "build rc=$?"
npm run bundle > $SCRATCH/logs/bundle-base.log 2>&1; echo "bundle rc=$?"
cp -Rc $SCRATCH/m2 $SCRATCH/m2-base
rm -rf $SCRATCH/m2-base/com/alibaba/qwen-managed-runtime-broker $SCRATCH/m2-base/com/alibaba/qwencode-sdk
MVN="/Users/wenshao/Install/maven/bin/mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$SCRATCH/m2-base"
$MVN -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $SCRATCH/logs/mvn-sdk-base.log 2>&1; echo "sdk rc=$?"
$MVN -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install > $SCRATCH/logs/mvn-broker-install-base.log 2>&1; echo "broker rc=$?"
$MVN -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests package > $SCRATCH/logs/mvn-server-package-base.log 2>&1; echo "server rc=$?"
cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $SCRATCH/jars/base-server.jar
ls -la dist/cli.js $SCRATCH/jars/
git rev-parse HEAD; git status --short | wc -l
