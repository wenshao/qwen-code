#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682): build the moved head 6c66366a (h2: TS bundle + jar) and new main 9763580b (m2: jar only).
set -u
V=/root/v13682; L=$V/out; export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 QWEN_SKIP_PREPARE=1 HUSKY=0 CI=1
cd /root/git/qwen-code
git worktree add -f --detach $V/h2 v13682-h2 > $L/wt2.log 2>&1
git worktree add -f --detach $V/m2 9763580b84225b4811bd05c716f1d05b37cfdf9d >> $L/wt2.log 2>&1
echo "start $(date -u +%T) h2=$(git -C $V/h2 rev-parse --short HEAD) m2=$(git -C $V/m2 rev-parse --short HEAD)" > $L/main2.log
cd $V/h2 && nice -n 5 corepack pnpm install --frozen-lockfile --prefer-offline > $L/install-h2.log 2>&1; echo "install exit=$? $(date -u +%T)" >> $L/main2.log
( for A in h2 m2; do nice -n 5 bash $V/build-java.sh $A > $L/java-$A.log 2>&1; echo "[$A] jar $(date -u +%T) $(tail -3 $L/java-$A.log | tr "\n" " ")" >> $L/main2.log; done; echo JAVA-DONE >> $L/main2.log ) &
cd $V/h2 && nice -n 5 npm run build > $L/build-h2.log 2>&1; echo "[h2] build exit=$? $(date -u +%T)" >> $L/main2.log
nice -n 5 npm run bundle > $L/bundle-h2.log 2>&1; echo "[h2] bundle exit=$? $(date -u +%T)" >> $L/main2.log
rm -rf $V/rig/dist/h2 && cp -a dist $V/rig/dist/h2
wait
for A in h2 m2; do ln -sfn $V/server/$A-server.jar $V/rig/server/$A-server.jar; done
echo ALL-DONE $(date -u +%T) >> $L/main2.log
