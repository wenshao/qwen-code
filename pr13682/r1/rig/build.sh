#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682): build head 785dc863 (h) and merge base 2ebbd4e1 (b): TS bundle + server jar per arm.
set -u
V=/root/v13682; L=$V/out; mkdir -p $L $V/server $V/rig/dist
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 QWEN_SKIP_PREPARE=1 HUSKY=0 CI=1
cd /root/git/qwen-code
git worktree add -f --detach $V/h v13682-h > $L/wt.log 2>&1
git worktree add -f --detach $V/b 2ebbd4e12d253f40e6cbfcb0ec1d12203008b648 >> $L/wt.log 2>&1
echo "start $(date -u +%T) h=$(git -C $V/h rev-parse --short HEAD) b=$(git -C $V/b rev-parse --short HEAD)" > $L/main.log
cd $V/h && corepack pnpm install --frozen-lockfile --prefer-offline > $L/install-h.log 2>&1; echo "install exit=$? $(date -u +%T)" >> $L/main.log
cd $V/h; for d in $(find . -maxdepth 4 -name node_modules -type d -not -path "./node_modules/*" -not -path "*/node_modules/*/node_modules"); do mkdir -p $V/b/$(dirname $d); cp -al $d $V/b/$d 2>/dev/null; done
echo "nm shared $(date -u +%T)" >> $L/main.log
( for A in h b; do bash $V/build-java.sh $A > $L/java-$A.log 2>&1; echo "[$A] jar $(date -u +%T) $(tail -3 $L/java-$A.log | tr "\n" " ")" >> $L/main.log; done; echo JAVA-DONE >> $L/main.log ) &
for A in h b; do cd $V/$A
  npm run build > $L/build-$A.log 2>&1; echo "[$A] build exit=$? $(date -u +%T)" >> $L/main.log
  npm run bundle > $L/bundle-$A.log 2>&1; echo "[$A] bundle exit=$? $(date -u +%T)" >> $L/main.log
  rm -rf $V/rig/dist/$A && cp -a dist $V/rig/dist/$A
done
echo TS-DONE >> $L/main.log
wait
echo ALL-DONE $(date -u +%T) >> $L/main.log
