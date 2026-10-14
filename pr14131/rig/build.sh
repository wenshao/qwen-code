#!/bin/bash
# usage (inside qwen-managed-e2e:u24 with -v /root:/root, host network for the 127.0.0.1:10809 proxy): build.sh
# Base tree = main 91385884eb (PR #14131 parent). Mirrors CI "Install, build and bundle CLI" +
# "Install Managed Agent dependencies" into a rig-private m2. Serial build (concurrency 1) to keep the 15 GiB host healthy.
set -uo pipefail
R=/root/pr14131-rig; W=$R/src-base; M2=$R/m2; L=$R/out/build-base.log
mkdir -p $R/out; exec >> $L 2>&1
echo "=== $(date -u +%FT%TZ) build base"
if [ ! -d $W ]; then
  mkdir -p $W && tar xzf $R/up/base.tgz -C $W || { echo "extract failed"; exit 1; }
  (cd $W && git init -q && git add -A && git -c user.name=rig -c user.email=rig@local commit -q --no-verify -m base-91385884eb) || echo "git init warn"
fi
export https_proxy=http://127.0.0.1:10809 http_proxy=http://127.0.0.1:10809 HTTPS_PROXY=http://127.0.0.1:10809 HTTP_PROXY=http://127.0.0.1:10809
export QWEN_SKIP_PREPARE=1 CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0 npm_config_workspace_concurrency=1 npm_config_child_concurrency=1
cd $W
corepack pnpm install --frozen-lockfile --prefer-offline --child-concurrency=1 --reporter=append-only > $R/out/pnpm-base.log 2>&1; echo "pnpm install exit=$?"
npm run build > $R/out/tsbuild-base.log 2>&1; echo "build exit=$?"
npm run bundle > $R/out/bundle-base.log 2>&1; echo "bundle exit=$?"
ls -la $W/dist/cli.js
MV="mvn -B -ntp -s /root/.m2/settings.xml -Dmaven.repo.local=$M2"
(cd $W/packages/sdk-java/qwencode && $MV -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $R/out/mvn-sdk-base.log 2>&1); echo "qwencode install exit=$?"
(cd $W/packages/sdk-java/runtime-broker && $MV -DskipTests -Dspotbugs.skip=true install > $R/out/mvn-broker-base.log 2>&1); echo "broker install exit=$?"
echo "=== $(date -u +%FT%TZ) BUILD-DONE"
