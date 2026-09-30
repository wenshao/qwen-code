#!/bin/bash
# macOS host: bundle for a worktree.  usage: build-ts.sh <worktree> <label>
set -u
. /rig/rig.env
W=$RIG/$1; L=$2
export PATH=$(dirname $NODE):$PATH
cd $W
corepack pnpm install --frozen-lockfile --offline --ignore-scripts > $RIG/out/build-$L-install.log 2>&1; echo "install exit=$?" >> $RIG/out/build-$L-install.log
npm run build > $RIG/out/build-$L-build.log 2>&1; echo "build exit=$?" >> $RIG/out/build-$L-build.log
npm run bundle > $RIG/out/build-$L-bundle.log 2>&1; echo "bundle exit=$?" >> $RIG/out/build-$L-bundle.log
rm -rf $RIG/dist/$L && cp -Rc dist $RIG/dist/$L
echo "[$L] node=$(node -v) $(tail -1 $RIG/out/build-$L-install.log) $(tail -1 $RIG/out/build-$L-build.log) $(tail -1 $RIG/out/build-$L-bundle.log) head=$(git -C $W rev-parse --short HEAD) cli.js sha256=$(shasum -a 256 dist/cli.js | cut -c1-16) $(date -u +%T)"
