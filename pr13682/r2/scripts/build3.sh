#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682 round 2): build head 7105fb1e (h3) and new merge base 543f03e5 (m3): TS bundle + jar each;
# t3 = 23316dd7 (test file before 7105fb1e) for the flaky-test comparison only.
set -u
V=/root/v13682; L=$V/out; export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 QWEN_SKIP_PREPARE=1 HUSKY=0 CI=1
cd /root/git/qwen-code
git worktree add -f --detach $V/h3 7105fb1e4c50bf924a40966c185f47308a74b84a > $L/wt3.log 2>&1
git worktree add -f --detach $V/m3 543f03e5b1340db42208081d22dcac7a80019e82 >> $L/wt3.log 2>&1
git worktree add -f --detach $V/t3 23316dd74db0d1dd62920ff9860c6ce3604db1d7 >> $L/wt3.log 2>&1
echo "start $(date -u +%T) h3=$(git -C $V/h3 rev-parse --short HEAD) m3=$(git -C $V/m3 rev-parse --short HEAD) t3=$(git -C $V/t3 rev-parse --short HEAD)" > $L/main3.log
cd $V/h3 && corepack pnpm install --frozen-lockfile --prefer-offline > $L/install-h3.log 2>&1; echo "install h3 exit=$? $(date -u +%T)" >> $L/main3.log
cd $V/m3 && corepack pnpm install --frozen-lockfile --prefer-offline > $L/install-m3.log 2>&1; echo "install m3 exit=$? $(date -u +%T)" >> $L/main3.log
( for A in h3 m3; do bash $V/build-java.sh $A > $L/java-$A.log 2>&1; echo "[$A] jar $(date -u +%T) $(tail -3 $L/java-$A.log | tr "\n" " ")" >> $L/main3.log; done; echo JAVA-DONE >> $L/main3.log ) &
for A in h3 m3; do cd $V/$A
  npm run build > $L/build-$A.log 2>&1; echo "[$A] build exit=$? $(date -u +%T)" >> $L/main3.log
  npm run bundle > $L/bundle-$A.log 2>&1; echo "[$A] bundle exit=$? $(date -u +%T)" >> $L/main3.log
  rm -rf $V/rig/dist/$A && cp -a dist $V/rig/dist/$A
done
echo TS-DONE >> $L/main3.log
wait
for A in h3 m3; do ln -sfn $V/server/$A-server.jar $V/rig/server/$A-server.jar; done
echo ALL-DONE $(date -u +%T) >> $L/main3.log
