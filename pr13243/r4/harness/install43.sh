#!/bin/bash
# PR #13243 rig: install deps in one worktree. usage: install43.sh <wt>
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd /Users/wenshao/pr13243-rig/$1 || exit 9
echo "start $(date -u +%T) node=$(node -v) head=$(git rev-parse --short HEAD)"
corepack pnpm install --frozen-lockfile --prefer-offline 2>&1 | tail -15
echo "install exit=${PIPESTATUS[0]} $(date -u +%T)"
