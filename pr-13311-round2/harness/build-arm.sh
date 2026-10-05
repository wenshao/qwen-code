#!/bin/bash
# usage: build-arm.sh <armdir>
set -o pipefail
cd "$1" || exit 1
start=$(date +%s)
QWEN_SKIP_PREPARE=1 HUSKY=0 corepack pnpm install --frozen-lockfile > ../$(basename $1)-install.log 2>&1; rc=$?
echo "INSTALL_EXIT=$rc $(( $(date +%s)-start ))s"
[ $rc -eq 0 ] || exit $rc
npm run build > ../$(basename $1)-build.log 2>&1; rc=$?
echo "BUILD_EXIT=$rc $(( $(date +%s)-start ))s"
[ $rc -eq 0 ] || exit $rc
npm run bundle > ../$(basename $1)-bundle.log 2>&1; rc=$?
echo "BUNDLE_EXIT=$rc $(( $(date +%s)-start ))s"
