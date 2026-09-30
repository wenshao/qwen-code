#!/bin/bash
# macOS host: build + bundle the CLI in a rig worktree. node_modules are APFS-cloned from an earlier rig
# whose lockfiles are byte-identical (checked with git diff). usage: build-ts.sh <worktree> <label>
set -u
RIG=/Users/wenshao/pr13095-rig; SRC=/Users/wenshao/pr13088-rig/wt-base; W=$RIG/$1; L=$2
cd $SRC
find . -name node_modules -type d -not -path '*/node_modules/*' | while read -r d; do
  [ ! -e "$W/$d" ] && mkdir -p "$(dirname "$W/$d")" && cp -Rc "$d" "$W/$d"
done
cd $W
echo "[$L] $(date +%T) node=$(node -v) head=$(git rev-parse --short HEAD)"
npm run build > $RIG/out/build-$L-build.log 2>&1; echo "build exit=$?" >> $RIG/out/build-$L-build.log
npm run bundle > $RIG/out/build-$L-bundle.log 2>&1; echo "bundle exit=$?" >> $RIG/out/build-$L-bundle.log
rm -rf $RIG/dist/$L && cp -Rc dist $RIG/dist/$L
echo "[$L] $(date +%T) $(tail -1 $RIG/out/build-$L-build.log) $(tail -1 $RIG/out/build-$L-bundle.log) cli.js=$(wc -c < dist/cli.js | tr -d ' ') chunks=$(ls dist/chunks 2>/dev/null | wc -l | tr -d ' ')"
echo "[$L] BUILD-TS-DONE"
