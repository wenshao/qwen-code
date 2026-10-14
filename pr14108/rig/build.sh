#!/bin/bash
# usage (inside qwen-managed-e2e:u24, host network for the 127.0.0.1:10809 proxy): build.sh
# Builds the base tree (main 6212189f1f = PR #14108 parent) exactly like the CI "Install, build and bundle CLI"
# + "Install Managed Agent dependencies" steps, into a rig-private m2.
set -uo pipefail
R=/root/pr14108-rig; W=$R/src-base; M2=$R/m2; L=$R/out/build-base.log
exec >> $L 2>&1
echo "=== $(date +%T) build base"
if [ ! -d $W ]; then
  mkdir -p $W && tar xzf $R/up/base.tgz -C $W || { echo "extract failed"; exit 1; }
  (cd $W && git init -q && git add -A && git -c user.name=rig -c user.email=rig@local commit -q --no-verify -m base-6212189f1f) || echo "git init warn"
fi
export https_proxy=http://127.0.0.1:10809 http_proxy=http://127.0.0.1:10809 HTTPS_PROXY=http://127.0.0.1:10809 HTTP_PROXY=http://127.0.0.1:10809
export QWEN_SKIP_PREPARE=1 CI=true
cd $W
corepack pnpm install --frozen-lockfile --prefer-offline --reporter=append-only > $R/out/pnpm-base.log 2>&1; echo "pnpm install exit=$?"
npm run build > $R/out/tsbuild-base.log 2>&1; echo "build exit=$?"
npm run bundle > $R/out/bundle-base.log 2>&1; echo "bundle exit=$?"
ls -la $W/dist/cli.js
MV="mvn -B -ntp -s $R/settings.xml -Dmaven.repo.local=$M2"
(cd $W/packages/sdk-java/qwencode && $MV -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $R/out/mvn-sdk-base.log 2>&1); echo "qwencode install exit=$?"
(cd $W/packages/sdk-java/runtime-broker && $MV -DskipTests -Dspotbugs.skip=true install > $R/out/mvn-broker-base.log 2>&1); echo "broker install exit=$?"
echo "=== $(date +%T) BUILD-DONE"
