#!/bin/bash
# Bundle the CLI (Hosted Harness + Broker worker entry) from <worktree>. usage: build-ts.sh <worktree>
set -u
RIG=/Users/wenshao/pr13116-rig; W=$RIG/$1; cd $W
S=$(date +%s)
corepack pnpm install --frozen-lockfile --prefer-offline > $RIG/logs/ts-$1-install.log 2>&1; A=$?
npm run build > $RIG/logs/ts-$1-build.log 2>&1; B=$?
npm run bundle > $RIG/logs/ts-$1-bundle.log 2>&1; C=$?
echo "RESULT build-ts $1 install=$A build=$B bundle=$C secs=$(( $(date +%s) - S )) head=$(git rev-parse --short=10 HEAD) cli=$(ls -la dist/cli.js 2>&1 | awk '{print $5}')"
