#!/bin/bash
# build + bundle one worktree; usage: build-ts.sh <worktree-dir-name> <label>
set -u
RIG=/Users/wenshao/pr13135-rig; W=$RIG/$1; L=$2
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd $W
npm run build > $RIG/out/build-$L-build.log 2>&1; echo "build exit=$?" >> $RIG/out/build-$L-build.log
npm run bundle > $RIG/out/build-$L-bundle.log 2>&1; echo "bundle exit=$?" >> $RIG/out/build-$L-bundle.log
rm -rf $RIG/dist/$L && cp -Rc dist $RIG/dist/$L
echo "[$L] $(tail -1 $RIG/out/build-$L-build.log) $(tail -1 $RIG/out/build-$L-bundle.log) head=$(git -C $W rev-parse --short HEAD) sha=$(shasum -a 256 $RIG/dist/$L/cli.js | cut -c1-16) $(date -u +%T)"
