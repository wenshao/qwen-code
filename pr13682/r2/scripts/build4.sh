#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682 R2): main moved to d35277c2 with its own V66. Jars for current main (m4), the
# PR-into-main merge tree (x4, two V66 files) and that merge with the PR migration renamed to V67 (x4r).
set -u
V=/root/v13682; L=$V/out; cd /root/git/qwen-code
git fetch -q origin d35277c2f3 2>/dev/null || git fetch -q origin main
MAIN=$(git rev-parse --verify d35277c2f3^{commit}); echo "main=$MAIN" > $L/main4.log
git worktree add -f --detach $V/m4 $MAIN >> $L/wt4.log 2>&1
git worktree add -f --detach $V/x4 $MAIN >> $L/wt4.log 2>&1
cd $V/x4 && git -c user.name=rig -c user.email=rig@localhost merge -q --no-edit 7105fb1e4c50bf924a40966c185f47308a74b84a >> $L/wt4.log 2>&1; echo "x4 merge rc=$? head=$(git rev-parse --short HEAD) tree=$(git rev-parse HEAD^{tree})" >> $L/main4.log
git -C /root/git/qwen-code worktree add -f --detach $V/x4r $(git -C $V/x4 rev-parse HEAD) >> $L/wt4.log 2>&1
cd $V/x4r && D=packages/sdk-java/managed-agent-server/src/main/resources/db/migration && git mv $D/V66__managed_session_rename_delivery.sql $D/V67__managed_session_rename_delivery.sql && git -c user.name=rig -c user.email=rig@localhost commit -q -m "rig: renumber rename delivery to V67" && echo "x4r head=$(git rev-parse --short HEAD)" >> $L/main4.log
for A in m4 x4 x4r; do bash $V/build-java.sh $A > $L/java-$A.log 2>&1; echo "[$A] $(tail -3 $L/java-$A.log | tr '\n' ' ')" >> $L/main4.log; ln -sfn $V/server/$A-server.jar $V/rig/server/$A-server.jar; done
echo ALL4-DONE $(date -u +%T) >> $L/main4.log
