#!/bin/bash
# install deps in one worktree via the repo's pnpm bootstrap; usage: setup-deps.sh <wt-name>
R=/Users/wenshao/pr13135-rig; W=$R/$1
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd $W && node scripts/setup-worktree.js > $R/out/setup-$1.log 2>&1; echo "[$1] setup exit=$? $(date -u +%T)" >> $R/out/setup-$1.log
