#!/bin/bash
# usage: build.sh <arm>   (runs natively on the test host; logs to /root/pr13931-rig/out/build-<arm>.log)
set -uo pipefail
A=$1; R=/root/pr13931-rig; W=$R/src-$A; M2=$R/m2-$A; L=$R/out/build-$A.log
mkdir -p $R/out
exec > >(tee -a $L) 2>&1
echo "=== $(date +%T) build $A"
if [ ! -d $W ]; then
  mkdir -p $W && tar xzf $R/up/$A.tgz -C $W || { echo "[$A] extract failed"; exit 1; }
  (cd $W && git init -q && git add -A && git -c user.name=rig -c user.email=rig@local commit -q --no-verify -m "$A") || echo "[$A] git init warn"
fi
export https_proxy=http://127.0.0.1:10809 http_proxy=http://127.0.0.1:10809 HTTPS_PROXY=http://127.0.0.1:10809 HTTP_PROXY=http://127.0.0.1:10809
export QWEN_SKIP_PREPARE=1 CI=true
cd $W
corepack pnpm install --frozen-lockfile --prefer-offline --reporter=append-only > $R/out/pnpm-$A.log 2>&1; echo "[$A] pnpm install exit=$?"
npm run build > $R/out/tsbuild-$A.log 2>&1; echo "[$A] build exit=$?"
npm run bundle > $R/out/bundle-$A.log 2>&1; echo "[$A] bundle exit=$?"
ls -la $W/dist/cli.js
if [ ! -d $M2 ]; then
  cp -r /seed-m2 $M2 && rm -rf $M2/com/alibaba/qwencode-sdk $M2/com/alibaba/qwen-managed-runtime-broker $M2/com/alibaba/qwen-managed-agent-server
fi
MV="mvn -B -ntp -s $R/settings.xml -Dmaven.repo.local=$M2"
(cd $W/packages/sdk-java/qwencode && $MV -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $R/out/mvn-sdk-$A.log 2>&1); echo "[$A] qwencode install exit=$?"
(cd $W/packages/sdk-java/runtime-broker && $MV -DskipTests -Dspotbugs.skip=true install > $R/out/mvn-broker-$A.log 2>&1); echo "[$A] broker install exit=$?"
echo "=== $(date +%T) [$A] BUILD-DONE"
