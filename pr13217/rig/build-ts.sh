#!/bin/bash
# Build the packaged Harness (dist/cli.js) once from src-main; the PR changes no TS.
RIG=/Users/wenshao/pr13217-rig; W=$RIG/src-main; L=$RIG/out/build-ts.log
echo "=== $(date +%T) setup ($(git -C $W rev-parse --short HEAD))" | tee $L
(cd $W && node scripts/setup-worktree.js) >> $L 2>&1; echo "setup exit=$?" | tee -a $L
(cd $W && npm run build) >> $L 2>&1; echo "build exit=$?" | tee -a $L
(cd $W && npm run bundle) >> $L 2>&1; echo "bundle exit=$?" | tee -a $L
ls -la $W/dist/cli.js 2>&1 | tee -a $L
echo "=== $(date +%T) BUILD-TS-DONE" | tee -a $L
