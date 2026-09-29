#!/bin/bash
# usage: build-arm.sh <arm-dir>
set -o pipefail
cd "$1" || exit 1
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
start=$(date +%s)
QWEN_SKIP_PREPARE=1 HUSKY=0 corepack pnpm install --frozen-lockfile > install.log 2>&1; echo "INSTALL_EXIT=$? t=$(( $(date +%s)-start ))s"
npm run build > build.log 2>&1; echo "BUILD_EXIT=$? t=$(( $(date +%s)-start ))s"
npm run bundle > bundle.log 2>&1; echo "BUNDLE_EXIT=$? t=$(( $(date +%s)-start ))s"
echo "EXIT=done"
