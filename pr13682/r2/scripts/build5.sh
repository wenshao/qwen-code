#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682 R2): the head moved to ab1af693 (merge of main d35277c2 + V66->V67). Build h4 (TS bundle + jar).
set -u
V=/root/v13682; L=$V/out; export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 QWEN_SKIP_PREPARE=1 HUSKY=0 CI=1
cd /root/git/qwen-code && git fetch -q origin ab1af693957bd908157297f6e624a4e4a69d62cf
git worktree add -f --detach $V/h4 ab1af693957bd908157297f6e624a4e4a69d62cf > $L/wt5.log 2>&1
echo "start $(date -u +%T) h4=$(git -C $V/h4 rev-parse --short HEAD)" > $L/main5.log
cd $V/h4 && nice -n 5 corepack pnpm install --frozen-lockfile --prefer-offline > $L/install-h4.log 2>&1; echo "install exit=$? $(date -u +%T)" >> $L/main5.log
( nice -n 5 bash $V/build-java.sh h4 > $L/java-h4.log 2>&1; echo "[h4] jar $(date -u +%T) $(tail -3 $L/java-h4.log | tr '\n' ' ')" >> $L/main5.log ) &
nice -n 5 npm run build > $L/build-h4.log 2>&1; echo "[h4] build exit=$? $(date -u +%T)" >> $L/main5.log
nice -n 5 npm run bundle > $L/bundle-h4.log 2>&1; echo "[h4] bundle exit=$? $(date -u +%T)" >> $L/main5.log
rm -rf $V/rig/dist/h4 && cp -a dist $V/rig/dist/h4
wait
ln -sfn $V/server/h4-server.jar $V/rig/server/h4-server.jar
echo ALL5-DONE $(date -u +%T) >> $L/main5.log
