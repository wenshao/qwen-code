#!/bin/bash
# Build the packaged Harness (dist/cli.js) for one arm.
A=$1; RIG=/Users/wenshao/pr13544-rig; W=$RIG/src-$A; L=$RIG/out/build-ts-$A.log
echo "=== $(date +%T) setup ($(git -C $W rev-parse --short HEAD))" | tee $L
(cd $W && node scripts/setup-worktree.js) >> $L 2>&1; echo "[$A] setup exit=$?" | tee -a $L
(cd $W && npm run build) >> $L 2>&1; echo "[$A] build exit=$?" | tee -a $L
(cd $W && npm run bundle) >> $L 2>&1; echo "[$A] bundle exit=$?" | tee -a $L
ls -la $W/dist/cli.js 2>&1 | tee -a $L
echo "=== $(date +%T) [$A] BUILD-TS-DONE" | tee -a $L
