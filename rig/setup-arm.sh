#!/bin/bash
# usage: setup-arm.sh <arm>  — install, build and bundle one worktree arm
ARM=$1
BASE=/Users/wenshao/git/pr13974-arms
cd $BASE/$ARM || exit 2
L=$BASE/logs/$ARM
{ QWEN_SKIP_PREPARE=1 pnpm install --frozen-lockfile; echo "SETUP exit=$?"; } > $L-setup.log 2>&1
grep -q "SETUP exit=0" $L-setup.log || { echo "ARM $ARM setup failed"; exit 1; }
{ npm run build; echo "BUILD_DONE exit=$?"; } > $L-build.log 2>&1
grep -q "BUILD_DONE exit=0" $L-build.log || { echo "ARM $ARM build failed"; exit 1; }
{ npm run bundle; echo "BUNDLE_DONE exit=$?"; } > $L-bundle.log 2>&1
grep -q "BUNDLE_DONE exit=0" $L-bundle.log || { echo "ARM $ARM bundle failed"; exit 1; }
echo "ARM $ARM ready $(git rev-parse HEAD) $(ls -la dist/cli.js)"
