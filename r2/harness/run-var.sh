#!/bin/bash
# run-var.sh <new|prev> <variant[+variant]|asis> <mutant[+mutant]|none>  -- retention test only
set -uo pipefail
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b6cd3c7d-d976-4528-aff7-a1b693841583/scratchpad
WT=/Users/wenshao/git/qwen-12250-r2; PKG=$WT/packages/acp-bridge; H=$SP/r2/harness; OUT=$SP/r2/out/var; mkdir -p $OUT
restore() { for f in session-control-plane.ts bridgeClient.ts bridge.test.ts; do git -C "$WT" show 02665c2cf7:packages/acp-bridge/src/$f > "$PKG/src/$f"; done; }
trap restore EXIT
restore
T=$1; V=$2; MID=$3
[ "$T" = prev ] && git -C "$WT" show 301dbdbeea:packages/acp-bridge/src/bridge.test.ts > "$PKG/src/bridge.test.ts"
if [ "$V" != asis ]; then for v in $(echo "$V" | tr '+' ' '); do python3 $H/variants2.py "$PKG/src/bridge.test.ts" "$v" >/dev/null || exit 2; done; fi
if [ "$MID" != none ]; then python3 $H/mutate2.py "$WT" $(echo "$MID" | tr '+' ' ') >/dev/null || exit 2; fi
tag="$T-$V-$MID"
# self-proof: hash of what is under test
echo "$tag $(cat $PKG/src/session-control-plane.ts $PKG/src/bridgeClient.ts | shasum | cut -c1-10) $(shasum $PKG/src/bridge.test.ts | cut -c1-10)" >> $OUT/hashes.txt
(cd "$PKG" && npx vitest run src/bridge.test.ts -t "retains a detached session whose only work" --reporter=json --outputFile="$OUT/$tag.json" > "$OUT/$tag.log" 2>&1)
node -e '
const r=require(process.argv[1]); let s=[];
for (const f of r.testResults) for (const a of f.assertionResults) if (a.status!=="skipped" && a.status!=="pending") {
  const m=(a.failureMessages[0]||""); s.push(a.status.toUpperCase() + (m? " " + m.split("\n")[0].replace(/\s+/g," ").slice(0,70) + " @" + ((m.match(/bridge\.test\.ts:\d+/)||[""])[0]).replace("bridge.test.ts","") : ""));
}
console.log(process.argv[2].padEnd(5), process.argv[3].padEnd(14), process.argv[4].padEnd(28), s.join(" | ") || "NO TEST RAN");
' "$OUT/$tag.json" "$T" "$V" "$MID" | tee -a $OUT/summary.txt
