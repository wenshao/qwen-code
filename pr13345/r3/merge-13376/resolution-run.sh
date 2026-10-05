#!/bin/bash
# usage: resolution-run.sh A|B
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad
source $S/env22.sh
X=$1; C=$(cat $S/r3/merge-13376-$X.txt | tr -d '[:space:]')
[ ${#C} -eq 40 ] || exit 2
git -C $S/wt-merge status --porcelain --untracked-files=no | grep -q . && { echo dirty; exit 3; }
git -C $S/wt-merge checkout --detach $C >/dev/null 2>&1 || exit 4
cd $S/wt-merge/packages/core && rm -rf dist && PATH=$S/wt-merge/node_modules/.bin:$PATH node ../../scripts/build_package.js > $S/r3/logs/build-merge-$X.log 2>&1
test -f dist/src/managed-runtime/managed-session-authority.js || { echo "no dist"; exit 5; }
npx vitest run src/managed-runtime/managed-session-authority.extension.test.ts src/managed-runtime/managed-session-metadata.test.ts src/managed-runtime/managed-session-authority.test.ts src/managed-runtime/managed-session-record-sink.test.ts \
  --reporter=json --outputFile=$S/r3/results/merge-13376-$X-ts.json --coverage.enabled=false > $S/r3/logs/merge-13376-$X-ts.log 2>&1
node $S/mut/summarize-ts.mjs $S/r3/results/merge-13376-$X-ts.json merge13376$X tests | cut -c1-400
cd $S/rig && ARM=merge$X LOCAL=1 node r10-domain.mjs 2>&1 | grep -E '^\[R1[0-2]\]' | cut -c1-420
