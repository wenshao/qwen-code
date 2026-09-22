#!/bin/bash
# build-arm.sh <armName> <sourceFile> : bundle with packages/cli/src/serve/run-qwen-serve.ts := sourceFile, then restore head
set -e
cd /root/git/qwen-code-x8
F=packages/cli/src/serve/run-qwen-serve.ts
NAME=$1; SRC=$2
cp "$SRC" $F
node esbuild.config.js > .verify-arms/$NAME.esbuild.log 2>&1
node scripts/copy_bundle_assets.js >> .verify-arms/$NAME.esbuild.log 2>&1
rm -rf .verify-arms/$NAME && cp -a dist .verify-arms/$NAME
git show c00d385:$F > $F
git diff --quiet -- $F && echo "restored $F"
echo "$NAME chunk: $(ls .verify-arms/$NAME/chunks | grep run-qwen-serve) sha256=$(sha256sum .verify-arms/$NAME/chunks/run-qwen-serve-*.js | cut -c1-16) files=$(find .verify-arms/$NAME -type f | wc -l)"
