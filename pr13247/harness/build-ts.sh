#!/bin/bash
# macOS host: build + bundle one worktree (node_modules cloned from a built worktree with identical pnpm-lock).  usage: build-ts.sh <label> <worktree>
set -u
RIG=/Users/wenshao/pr13247-rig; L=$1; W=$2
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd $W
npm run build > $RIG/out/build-$L-build.log 2>&1; echo "build exit=$?" >> $RIG/out/build-$L-build.log
npm run bundle > $RIG/out/build-$L-bundle.log 2>&1; echo "bundle exit=$?" >> $RIG/out/build-$L-bundle.log
rm -rf $RIG/dist/$L && cp -Rc dist $RIG/dist/$L
echo "[$L] $(tail -1 $RIG/out/build-$L-build.log) $(tail -1 $RIG/out/build-$L-bundle.log) head=$(git -C $W rev-parse --short HEAD) $(date -u +%T)"
