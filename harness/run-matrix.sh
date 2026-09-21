#!/bin/bash
# Run the whole packages/acp-bridge suite once per (test-arm, mutation).
#   test-arm: pr   = PR head test files (171e1b17fc)
#             base = merge-base test files (009aab05b2) -- production identical
# Usage: run-matrix.sh <test-arm> <mutation-id|none>...
set -uo pipefail
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/18c1820a-1613-4390-bf90-2a36b9a07089/scratchpad
WT=/Users/wenshao/git/qwen-12250-head
PKG=$WT/packages/acp-bridge
OUT=$SP/mut/out
BK=$SP/mut/backup
mkdir -p "$OUT" "$BK"
ARM=$1; shift
for f in session-control-plane.ts bridgeClient.ts bridge.test.ts bridgeClient.test.ts; do
  [ -f "$BK/$f" ] || cp "$PKG/src/$f" "$BK/$f"
done
restore() {
  for f in session-control-plane.ts bridgeClient.ts bridge.test.ts bridgeClient.test.ts; do
    cp "$BK/$f" "$PKG/src/$f"
  done
}
trap restore EXIT
for MID in "$@"; do
  restore
  if [ "$ARM" = base ]; then
    git -C "$WT" show 009aab05b2:packages/acp-bridge/src/bridge.test.ts > "$PKG/src/bridge.test.ts"
    git -C "$WT" show 009aab05b2:packages/acp-bridge/src/bridgeClient.test.ts > "$PKG/src/bridgeClient.test.ts"
  fi
  if [ "$MID" != none ]; then
    python3 "$SP/mut/mutate.py" "$WT" $(echo "$MID" | tr '+' ' ') || { echo "MUTATION FAILED $MID"; exit 2; }
  fi
  # self-proof: the diff that is actually under test
  git -C "$WT" diff --stat -- packages/acp-bridge/src > "$OUT/$ARM-$MID.diffstat"
  git -C "$WT" diff -U0 -- packages/acp-bridge/src/session-control-plane.ts packages/acp-bridge/src/bridgeClient.ts > "$OUT/$ARM-$MID.prod.diff"
  start=$(date +%s)
  (cd "$PKG" && npx vitest run --reporter=json --outputFile="$OUT/$ARM-$MID.json" > "$OUT/$ARM-$MID.log" 2>&1)
  rc=$?
  end=$(date +%s)
  node -e '
    const r=require(process.argv[1]);
    const fails=[];
    for (const f of r.testResults) for (const a of f.assertionResults) if (a.status==="failed") fails.push(a.fullName);
    console.log(`'"$ARM"' '"$MID"' rc='"$rc"' files=${r.numTotalTestSuites} tests=${r.numTotalTests} passed=${r.numPassedTests} failed=${r.numFailedTests} ('"$((end-start))"'s)`);
    for (const f of fails) console.log("   x " + f);
  ' "$OUT/$ARM-$MID.json" | tee -a "$OUT/summary.txt"
done
