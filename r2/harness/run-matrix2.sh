#!/bin/bash
# Whole packages/acp-bridge suite once per (test-arm, mutant), on the R2 head.
#   pr   = PR head test files (02665c2cf7)
#   base = merge-base test files (97b1b252e3) -- production identical
# Usage: run-matrix2.sh <pr|base> <mutant[+mutant]|none>...
set -uo pipefail
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b6cd3c7d-d976-4528-aff7-a1b693841583/scratchpad
WT=/Users/wenshao/git/qwen-12250-r2; PKG=$WT/packages/acp-bridge; H=$SP/r2/harness; OUT=$SP/r2/out/matrix; mkdir -p $OUT
FILES="session-control-plane.ts bridgeClient.ts bridge.test.ts bridgeClient.test.ts"
restore() { for f in $FILES; do git -C "$WT" show 02665c2cf7:packages/acp-bridge/src/$f > "$PKG/src/$f"; done; }
trap restore EXIT
ARM=$1; shift
for MID in "$@"; do
  restore
  if [ "$ARM" = base ]; then
    for f in bridge.test.ts bridgeClient.test.ts; do git -C "$WT" show 97b1b252e3:packages/acp-bridge/src/$f > "$PKG/src/$f"; done
  fi
  if [ "$MID" != none ]; then python3 $H/mutate2.py "$WT" $(echo "$MID" | tr '+' ' ') > /dev/null || { echo "MUTATION FAILED $MID"; exit 2; }; fi
  git -C "$WT" diff -U0 -- packages/acp-bridge/src/session-control-plane.ts packages/acp-bridge/src/bridgeClient.ts > "$OUT/$ARM-$MID.prod.diff"
  echo "$ARM-$MID prod=$(cat $PKG/src/session-control-plane.ts $PKG/src/bridgeClient.ts | shasum | cut -c1-10) tests=$(cat $PKG/src/bridge.test.ts $PKG/src/bridgeClient.test.ts | shasum | cut -c1-10)" >> $OUT/hashes.txt
  start=$(date +%s)
  (cd "$PKG" && npx vitest run --reporter=json --outputFile="$OUT/$ARM-$MID.json" > "$OUT/$ARM-$MID.log" 2>&1)
  rc=$?; end=$(date +%s)
  node -e '
    const r=require(process.argv[1]); const fails=[];
    for (const f of r.testResults) for (const a of f.assertionResults) if (a.status==="failed") fails.push(a.fullName);
    console.log(`'"$ARM"' '"$MID"' rc='"$rc"' tests=${r.numTotalTests} passed=${r.numPassedTests} failed=${r.numFailedTests} ('"$((end-start))"'s)`);
    for (const f of fails) console.log("   x " + f);
  ' "$OUT/$ARM-$MID.json" | tee -a "$OUT/summary.txt"
done
