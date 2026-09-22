#!/bin/bash
# build-arm2.sh <armName> <sourceFile> : bundle with run-qwen-serve.ts := sourceFile, then put the current working copy back
set -e
cd /root/git/qwen-code-x8
F=packages/cli/src/serve/run-qwen-serve.ts
NAME=$1; SRC=$2
cp $F /tmp/claude-0/-root-git-qwen-code-x8/be542fff-a6ec-49b0-b19c-124f7157819f/scratchpad/pr12396/harness/src/.wc-backup.ts
cp "$SRC" $F
node esbuild.config.js > .verify-arms/$NAME.esbuild.log 2>&1
node scripts/copy_bundle_assets.js >> .verify-arms/$NAME.esbuild.log 2>&1
rm -rf .verify-arms/$NAME && cp -a dist .verify-arms/$NAME
cp /tmp/claude-0/-root-git-qwen-code-x8/be542fff-a6ec-49b0-b19c-124f7157819f/scratchpad/pr12396/harness/src/.wc-backup.ts $F
echo "$NAME chunk: $(ls .verify-arms/$NAME/chunks | grep run-qwen-serve) sha256=$(sha256sum .verify-arms/$NAME/chunks/run-qwen-serve-*.js | cut -c1-16)"
