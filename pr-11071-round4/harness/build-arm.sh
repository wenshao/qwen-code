#!/bin/bash
# usage: build-arm.sh <arm>
cd /root/verify/pr11071-r4/$1 || exit 9
L=/root/verify/pr11071-r4/build-$1.log
start=$(date +%s)
QWEN_SKIP_PREPARE=1 HUSKY=0 corepack pnpm install --frozen-lockfile > $L 2>&1; i=$?
echo "INSTALL_EXIT=$i $(( $(date +%s)-start ))s" >> $L
[ $i -eq 0 ] || { echo "EXIT=fail" >> $L; exit 1; }
npm run build >> $L 2>&1; b=$?
echo "BUILD_EXIT=$b $(( $(date +%s)-start ))s" >> $L
[ $b -eq 0 ] && { npm run bundle >> $L 2>&1; echo "BUNDLE_EXIT=$? $(( $(date +%s)-start ))s" >> $L; }
echo "EXIT=done" >> $L
