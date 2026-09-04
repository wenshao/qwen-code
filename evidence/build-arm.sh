#!/bin/bash
set -e
WT="$1"; cd "$WT"
b(){ echo "--- build $1"; npm run build --workspace "$1" >/dev/null 2>&1 || { echo "FAILED $1"; exit 1; }; }
b @qwen-code/qwen-code-core
b @qwen-code/acp-bridge
node scripts/generate-git-commit-info.js
(cd packages/web-templates && node build.mjs >/dev/null 2>&1) || true
b @qwen-code/web-templates
b @qwen-code/channel-base
b @qwen-code/sdk
for c in telegram weixin dingtalk wecom feishu qqbot github gitlab dws; do
  n=$(node -p "try{require('./packages/channels/$c/package.json').name}catch(e){''}")
  [ -n "$n" ] && b "$n"
done
echo "--- esbuild"
node esbuild.config.js >/dev/null 2>&1
ls -l dist/cli.js
