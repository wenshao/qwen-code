#!/bin/bash
# Whole packages/acp-bridge suite once per (test-arm, mutant) at head fe6ca099.
# Production files are the head's in every arm (the PR touches no production
# code); only the two test files differ:
#   base = merge-base 97b1b252 tests   r2 = 02665c2c tests   r3 = fe6ca099 tests
#   r3fix = r3 + the three open bot suggestions (R5-2 row, R5-3 name, R6-1 assert)
#   r3settled = r3 with the queued-cd fixture settled (R5-3 hazard)
# Usage: run-matrix3.sh <worktree-copy> <arm> <mutant[+mutant]|none>...
set -uo pipefail
WT=$1; ARM=$2; shift 2
H=$(cd "$(dirname "$0")" && pwd); OUT=$H/../out/matrix; mkdir -p $OUT
PKG=$WT/packages/acp-bridge
put() { cp --remove-destination "$1" "$2"; }   # new inode: never writes through a hardlink
restore() {
  for f in session-control-plane.ts bridgeClient.ts bridgeClient.test.ts bridge.test.ts; do
    git -C /root/verify/pr12250-r3 show fe6ca099f6:packages/acp-bridge/src/$f > "$PKG/src/.$f.tmp" && mv "$PKG/src/.$f.tmp" "$PKG/src/$f"; done
  case $ARM in
    base) for f in bridge.test.ts bridgeClient.test.ts; do git -C /root/verify/pr12250-r3 show 97b1b252e3:packages/acp-bridge/src/$f > "$PKG/src/.$f.tmp" && mv "$PKG/src/.$f.tmp" "$PKG/src/$f"; done ;;
    r2)   for f in bridge.test.ts bridgeClient.test.ts; do git -C /root/verify/pr12250-r3 show 02665c2cf7:packages/acp-bridge/src/$f > "$PKG/src/.$f.tmp" && mv "$PKG/src/.$f.tmp" "$PKG/src/$f"; done ;;
    r3) ;;
    prop) git -C /root/verify/pr12250-r3 show fe6ca099f6:packages/acp-bridge/src/bridge.test.ts > "$PKG/src/.p.tmp" && mv "$PKG/src/.p.tmp" "$PKG/src/bridge.test.ts" && (cd "$WT" && git apply --unsafe-paths "$H/proposed.diff" 2>/dev/null || patch -s -p1 < "$H/proposed.diff") ;;
    r3fix|r3settled) python3 $H/variants3.py <(git -C /root/verify/pr12250-r3 show fe6ca099f6:packages/acp-bridge/src/bridge.test.ts) $ARM "$PKG/src/.v.tmp" >/dev/null && mv "$PKG/src/.v.tmp" "$PKG/src/bridge.test.ts" ;;
  esac
}
trap restore EXIT
for MID in "$@"; do
  restore
  if [ "$MID" != none ]; then python3 $H/mutate3.py "$WT" $(echo "$MID" | tr '+' ' ') > /dev/null || { echo "MUTATION FAILED $MID"; exit 2; }; fi
  echo "$ARM $MID prod=$(cat $PKG/src/session-control-plane.ts $PKG/src/bridgeClient.ts | sha1sum | cut -c1-10) tests=$(cat $PKG/src/bridge.test.ts $PKG/src/bridgeClient.test.ts | sha1sum | cut -c1-10)" >> $OUT/hashes.txt
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
