#!/bin/bash
# usage: build.sh <tree>   (runs inside the rig container)
set -euo pipefail
export PATH=/rig/node/bin:$PATH
cd /rig/$1
if [ ! -d .git ]; then
  git init -q -b rig && git -c user.name=rig -c user.email=rig@local add -A && git -c user.name=rig -c user.email=rig@local commit -q -m "$1 tree" && git log --oneline -1
fi
export npm_config_store_dir=/rig/pnpm-store
export CI=true
time npx -y pnpm@11.24.0 install --frozen-lockfile --prefer-offline --reporter=append-only --registry=https://registry.npmmirror.com
ls -la dist/cli.js
