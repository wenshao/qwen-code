#!/bin/bash
# macOS host: install + build + bundle the PR-head worktree.
set -u
RIG=/Users/wenshao/pr13206-rig; W=$RIG/${1:-wt}; L=${2:-head}
cd $W
corepack pnpm install --frozen-lockfile --prefer-offline > $RIG/out/build-$L-install.log 2>&1; echo "install exit=$?" >> $RIG/out/build-$L-install.log
npm run build > $RIG/out/build-$L-build.log 2>&1; echo "build exit=$?" >> $RIG/out/build-$L-build.log
npm run bundle > $RIG/out/build-$L-bundle.log 2>&1; echo "bundle exit=$?" >> $RIG/out/build-$L-bundle.log
rm -rf $RIG/dist/$L && cp -Rc dist $RIG/dist/$L
echo "[$L] $(tail -1 $RIG/out/build-$L-install.log) $(tail -1 $RIG/out/build-$L-build.log) $(tail -1 $RIG/out/build-$L-bundle.log) head=$(git -C $W rev-parse --short HEAD) $(date -u +%T)"
