#!/bin/bash
# usage: build-arm.sh <arm-dir>
set -o pipefail
cd "$1" || exit 1
start=$(date +%s)
echo "== install $(date)"
QWEN_SKIP_PREPARE=1 HUSKY=0 corepack pnpm install --frozen-lockfile > install.log 2>&1; echo "INSTALL_EXIT=$?"
echo "== build $(date)"
npm run build > build.log 2>&1; echo "BUILD_EXIT=$?"
echo "== bundle $(date)"
npm run bundle > bundle.log 2>&1; echo "BUNDLE_EXIT=$?"
echo "== done $(date) elapsed=$(( $(date +%s) - start ))s"
echo "EXIT=done"
