#!/bin/bash
# Whole packages/acp-bridge suite once per (test-arm, mutant), PR #12250 round 4.
# Production files are the tree's own in every arm (the PR touches no
# production code); only the two test files differ:
#   base = merge-base 97b1b252 tests   r3 = fe6ca099 tests   r4 = 7ab49d5e tests
#   r4settled = r4 with the queued-cd fixture settled (the R5-3 hazard)
#   merged = the merged tree's own tests (head 7ab49d5e + main 939b4db6)
# Usage: run-matrix4.sh <worktree> <arm> <mutant[+mutant]|none>...
set -uo pipefail
WT=$1; ARM=$2; shift 2
H=$(cd "$(dirname "$0")" && pwd); OUT=$H/../out/matrix; mkdir -p "$OUT"
PKG=$WT/packages/acp-bridge
PY="env DEVELOPER_DIR=/Library/Developer/CommandLineTools python3"
REV=$(git -C "$WT" rev-parse HEAD)
restore() {
  for f in session-control-plane.ts bridgeClient.ts bridgeClient.test.ts bridge.test.ts; do
    git -C "$WT" show "$REV:packages/acp-bridge/src/$f" > "$PKG/src/.$f.tmp" && mv "$PKG/src/.$f.tmp" "$PKG/src/$f"; done
  case $ARM in
    base) for f in bridge.test.ts bridgeClient.test.ts; do git -C "$WT" show 97b1b252e3:packages/acp-bridge/src/$f > "$PKG/src/.$f.tmp" && mv "$PKG/src/.$f.tmp" "$PKG/src/$f"; done ;;
    r3)   for f in bridge.test.ts bridgeClient.test.ts; do git -C "$WT" show fe6ca099f6:packages/acp-bridge/src/$f > "$PKG/src/.$f.tmp" && mv "$PKG/src/.$f.tmp" "$PKG/src/$f"; done ;;
    r4|merged) ;;
    r4settled) $PY "$H/variants4.py" <(git -C "$WT" show 7ab49d5e0d:packages/acp-bridge/src/bridge.test.ts) r4settled "$PKG/src/.v.tmp" >/dev/null && mv "$PKG/src/.v.tmp" "$PKG/src/bridge.test.ts" ;;
    *) echo "bad arm $ARM"; exit 2 ;;
  esac
}
trap 'ARM=r4; restore' EXIT   # leave the tree pristine, never a variant
for MID in "$@"; do
  restore
  if [ "$MID" != none ]; then $PY "$H/mutate3.py" "$WT" $(echo "$MID" | tr '+' ' ') > /dev/null || { echo "MUTATION FAILED $MID" | tee -a "$OUT/summary.txt"; exit 2; }; fi
  echo "$ARM $MID prod=$(cat $PKG/src/session-control-plane.ts $PKG/src/bridgeClient.ts | shasum | cut -c1-10) tests=$(cat $PKG/src/bridge.test.ts $PKG/src/bridgeClient.test.ts | shasum | cut -c1-10)" >> "$OUT/hashes.txt"
  start=$(date +%s)
  (cd "$PKG" && npx vitest run --reporter=json --outputFile="$OUT/$ARM-$MID.json" > "$OUT/$ARM-$MID.log" 2>&1)
  rc=$?; end=$(date +%s)
  node -e '
    const r=require(process.argv[1]); const fails=[];
    for (const f of r.testResults) { if (f.status==="failed" && !f.assertionResults.length) fails.push("SUITE "+f.name+": "+(f.message||"").slice(0,200));
      for (const a of f.assertionResults) if (a.status==="failed") fails.push(a.fullName + "  :: " + (a.failureMessages[0]||"").split("\n")[0].slice(0,160)); }
    console.log(`'"$ARM"' '"$MID"' rc='"$rc"' tests=${r.numTotalTests} passed=${r.numPassedTests} failed=${r.numFailedTests} ('"$((end-start))"'s)`);
    for (const f of fails) console.log("   x " + f);
  ' "$OUT/$ARM-$MID.json" | tee -a "$OUT/summary.txt"
done
