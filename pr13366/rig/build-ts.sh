#!/bin/bash
# usage: build-ts.sh <arm...>  — install deps (pnpm via setup-worktree), build, bundle; serial.
RIG=/Users/wenshao/pr13366-rig
for A in "$@"; do
  W=$RIG/src-$A; L=$RIG/out/build-$A.log; mkdir -p $RIG/out
  echo "=== $(date +%T) $A setup ($(git -C $W rev-parse --short HEAD))" | tee $L
  (cd $W && node scripts/setup-worktree.js) >> $L 2>&1; echo "[$A] setup exit=$?" | tee -a $L
  (cd $W && npm run build) >> $L 2>&1; echo "[$A] build exit=$?" | tee -a $L
  (cd $W && npm run bundle) >> $L 2>&1; echo "[$A] bundle exit=$?" | tee -a $L
  ls -la $W/dist/cli.js 2>&1 | tee -a $L
done
echo "=== $(date +%T) BUILD-TS-DONE"
