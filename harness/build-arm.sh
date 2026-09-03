#!/bin/bash
set -euo pipefail
WT="$1"
cd "$WT"
export NODE_OPTIONS="--max-old-space-size=4096"
log() { echo "=== [$(basename $WT)] $* ==="; }
log core;        npm run build --workspace @qwen-code/qwen-code-core >/dev/null
log acp-bridge;  npm run build --workspace @qwen-code/acp-bridge >/dev/null
log git-commit;  node scripts/generate-git-commit-info.js >/dev/null
log web-tpl;     (cd packages/web-templates && node build.mjs >/dev/null) && npm run build --workspace @qwen-code/web-templates >/dev/null
log channel-base; npm run build --workspace @qwen-code/channel-base >/dev/null
log sdk;         npm run build --workspace @qwen-code/sdk >/dev/null
for c in telegram weixin dingtalk wecom feishu qqbot github gitlab dws plugin-example; do
  [ -d "packages/channels/$c" ] || continue
  log "channel-$c"; npm run build --workspace @qwen-code/channel-$c >/dev/null
done
log bundle;      node esbuild.config.js >/dev/null
log DONE;        ls -la dist/cli.js
