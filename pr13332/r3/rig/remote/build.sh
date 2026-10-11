#!/bin/bash
# usage: build.sh <arm> <jar-file>  -- extract src-<arm>.tgz, build TS on Linux in the e2e image, drop in the jar
set -uo pipefail
R=/root/pr13332-rig; A=$1; JAR=$2
D=$R/src-$A
rm -rf $D; mkdir -p $D; tar -xzf $R/jars/src-$A.tgz -C $D || exit 1
mkdir -p $D/packages/sdk-java/managed-agent-server/target
cp $R/jars/$JAR $D/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
START=$(date +%s)
docker run --rm --init --name pr13332-build-$A --cpus 4 --memory 8g -v $R:$R -w $D --entrypoint bash \
  -e NODE_OPTIONS=--max-old-space-size=4096 -e QWEN_SKIP_PREPARE=1 qwen-managed-e2e:u24 \
  -c "corepack pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com && npm run build && npm run bundle" > $R/logs/build-$A.log 2>&1
RC=$?
echo "BUILD $A rc=$RC seconds=$(( $(date +%s)-START )) jar=$(sha256sum $D/packages/sdk-java/managed-agent-server/target/*.jar | cut -c1-16) cli=$(ls -la $D/dist/cli.js 2>/dev/null | wc -l)" | tee -a $R/logs/BUILDS.txt
