#!/bin/bash
# VERIFICATION RIG ONLY (PR #13194): build base (main b3dda468f2) and head (2486d3dad7) server jars, then the head CLI bundle.
R=/Users/wenshao/pr13135-rig
H=/Users/wenshao/git/qwen-code-pr13194; B=/Users/wenshao/git/qwen-code-pr13194-base
( $R/build-java.sh p94base $B $R/m2; $R/build-java.sh p94head $H $R/m2 ) > $R/out/p94-lane-java.log 2>&1 &
( export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
  cd $H && node scripts/setup-worktree.js > $R/out/p94-setup.log 2>&1; echo "setup exit=$?"
  npm run build > $R/out/p94-ts-build.log 2>&1; echo "build exit=$?"
  npm run bundle > $R/out/p94-ts-bundle.log 2>&1; echo "bundle exit=$?"
  rm -rf $R/dist/p94head && cp -Rc dist $R/dist/p94head
  echo "dist sha=$(shasum -a 256 $R/dist/p94head/cli.js | cut -c1-16) head=$(git -C $H rev-parse --short HEAD) $(date -u +%T)" ) > $R/out/p94-lane-ts.log 2>&1 &
wait
echo P94-BUILDS-DONE $(date -u +%T)
cat $R/out/p94-lane-*.log
