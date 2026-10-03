#!/bin/bash
# VERIFICATION RIG ONLY (PR #13168 R2): build + bundle one rig worktree. usage: build-ts.sh <worktree-dir-name> <label>
set -u
R=/Users/wenshao/pr13168-r2; W=$R/$1; L=$2
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:/usr/bin:/bin:/usr/sbin:/sbin
unset TSX_TSCONFIG_PATH
cd $W
npm run build > $R/out/build-$L-build.log 2>&1; echo "build exit=$?" >> $R/out/build-$L-build.log
npm run bundle > $R/out/build-$L-bundle.log 2>&1; echo "bundle exit=$?" >> $R/out/build-$L-bundle.log
rm -rf $R/dist/$L && cp -Rc dist $R/dist/$L
echo "[$L] $(tail -1 $R/out/build-$L-build.log) $(tail -1 $R/out/build-$L-bundle.log) head=$(git -C $W rev-parse --short HEAD) $(date -u +%T)"
