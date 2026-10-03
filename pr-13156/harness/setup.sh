#!/bin/bash
# usage: setup.sh <arm>
arm=$1
cd /root/verify/pr13156/$arm || exit 1
start=$(date +%s)
QWEN_SKIP_PREPARE=1 HUSKY=0 corepack pnpm install --frozen-lockfile > /root/verify/pr13156/install-$arm.log 2>&1
echo "INSTALL_EXIT=$? t=$(( $(date +%s)-start ))" >> /root/verify/pr13156/install-$arm.log
npm run build > /root/verify/pr13156/build-$arm.log 2>&1
echo "BUILD_EXIT=$? t=$(( $(date +%s)-start ))" >> /root/verify/pr13156/build-$arm.log
npm run bundle > /root/verify/pr13156/bundle-$arm.log 2>&1
echo "BUNDLE_EXIT=$? t=$(( $(date +%s)-start ))" >> /root/verify/pr13156/bundle-$arm.log
