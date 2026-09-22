#!/bin/bash
# usage: build-arm.sh <dir>
set -o pipefail
cd "$1" || exit 1
start=$(date +%s)
QWEN_SKIP_PREPARE=1 HUSKY=0 corepack pnpm install --frozen-lockfile > ../$(basename $1)-install.log 2>&1 || { echo "EXIT=install-fail"; exit 1; }
echo "install done $(( $(date +%s)-start ))s"
npm run build > ../$(basename $1)-build.log 2>&1 || { echo "EXIT=build-fail"; exit 1; }
echo "build done $(( $(date +%s)-start ))s"
npm run bundle > ../$(basename $1)-bundle.log 2>&1 || { echo "EXIT=bundle-fail"; exit 1; }
echo "bundle done $(( $(date +%s)-start ))s"
echo EXIT=0
