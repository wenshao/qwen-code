#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673): build + bundle the CLI from one worktree.  usage: build-ts.sh <arm>
RIG=/Users/wenshao/pr13673-rig; A=$1; W=/Users/wenshao/git/qwen-code-pr13673-$A
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd $W && node scripts/setup-worktree.js > $RIG/out/ts-setup-$A.log 2>&1; echo "[$A] setup exit=$?"
npm run build > $RIG/out/ts-build-$A.log 2>&1; echo "[$A] build exit=$?"
npm run bundle > $RIG/out/ts-bundle-$A.log 2>&1; echo "[$A] bundle exit=$?"
rm -rf $RIG/dist/$A && cp -Rc dist $RIG/dist/$A
echo "[$A] dist sha=$(shasum -a 256 $RIG/dist/$A/cli.js | cut -c1-16) head=$(git -C $W rev-parse --short HEAD) $(date -u +%T)"
