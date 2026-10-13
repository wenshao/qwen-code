#!/bin/bash
# Build the base tree (44ddf79ef4) natively: pnpm install + build + bundle, then hard-link copy for the PR arm.
set -uo pipefail
R=/root/pr14090-rig; W=$R/src-base; L=$R/out/build.log
exec > >(tee -a $L) 2>&1
echo "=== $(date +%T) build start"
if [ ! -d $W ]; then
  mkdir -p $W && tar xzf $R/up/base.tgz -C $W || { echo "extract failed"; exit 1; }
  (cd $W && git init -q && git add -A && git -c user.name=rig -c user.email=rig@local commit -q --no-verify -m base44ddf79ef4)
fi
export https_proxy=http://127.0.0.1:10809 http_proxy=http://127.0.0.1:10809 HTTPS_PROXY=http://127.0.0.1:10809 HTTP_PROXY=http://127.0.0.1:10809
export QWEN_SKIP_PREPARE=1 CI=true npm_config_workspace_concurrency=1 npm_config_child_concurrency=1
cd $W
corepack pnpm install --frozen-lockfile --prefer-offline --child-concurrency=1 --reporter=append-only > $R/out/pnpm.log 2>&1; echo "pnpm install exit=$?"
npm run build > $R/out/tsbuild.log 2>&1; echo "build exit=$?"
npm run bundle > $R/out/bundle.log 2>&1; echo "bundle exit=$?"
ls -la $W/dist/cli.js
echo "=== $(date +%T) BUILD-DONE"
