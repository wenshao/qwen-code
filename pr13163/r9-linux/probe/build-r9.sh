#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R9): build head 39267a90 (h9), base d735e20f (b9), and x9 = h9 with the 234037eb+00be8ed0 production reverted (jar only).
set -u
V=/root/v13163; L=$V/out/r9; mkdir -p $L
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 QWEN_SKIP_PREPARE=1 HUSKY=0 CI=1
cd /root/git/qwen-code
git worktree add -f --detach $V/h9 v13163-h9 > $L/wt.log 2>&1
git worktree add -f --detach $V/b9 v13163-b9 >> $L/wt.log 2>&1
git worktree add -f --detach $V/x9 v13163-h9 >> $L/wt.log 2>&1
cd $V/x9 && git revert --no-commit 00be8ed0ff 234037eb13 >> $L/wt.log 2>&1; echo "x9 revert exit=$?" >> $L/main.log
git -C $V/x9 status --short >> $L/wt.log
echo "start $(date -u +%T)" >> $L/main.log
cd $V/h9 && corepack pnpm install --frozen-lockfile > $L/install-h9.log 2>&1; echo "install exit=$? $(date -u +%T)" >> $L/main.log
for d in $(find . -maxdepth 4 -name node_modules -type d -not -path "./node_modules/*" -not -path "*/node_modules/*/node_modules"); do mkdir -p $V/b9/$(dirname $d); cp -al $d $V/b9/$d 2>/dev/null; done
echo "nm shared $(date -u +%T)" >> $L/main.log
( for A in h9 b9 x9; do bash $V/build-java.sh $A > $L/java-$A.log 2>&1; mkdir -p $V/rig/server; cp $V/server/$A-server.jar $V/rig/server/$A-server.jar; echo "[$A] jar $(date -u +%T) $(tail -3 $L/java-$A.log | tr "\n" " ")" >> $L/main.log; done; echo JAVA-DONE >> $L/main.log ) &
for A in h9 b9; do cd $V/$A
  npm run build > $L/build-$A.log 2>&1; echo "[$A] build exit=$? $(date -u +%T)" >> $L/main.log
  npm run bundle > $L/bundle-$A.log 2>&1; echo "[$A] bundle exit=$? $(date -u +%T)" >> $L/main.log
  rm -rf $V/rig/dist/$A && cp -a dist $V/rig/dist/$A
done
echo TS-DONE >> $L/main.log
wait
echo ALL-DONE $(date -u +%T) >> $L/main.log
