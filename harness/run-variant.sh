#!/bin/bash
# run-variant.sh <variant|asis> <mutation|none>  -- retention test only
set -uo pipefail
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/18c1820a-1613-4390-bf90-2a36b9a07089/scratchpad
WT=/Users/wenshao/git/qwen-12250-head; PKG=$WT/packages/acp-bridge; BK=$SP/mut/backup; OUT=$SP/mut/out
restore() { for f in session-control-plane.ts bridgeClient.ts bridge.test.ts bridgeClient.test.ts; do cp "$BK/$f" "$PKG/src/$f"; done; }
trap restore EXIT
restore
V=$1; MID=$2
[ "$V" != asis ] && python3 $SP/mut/retention-variants.py "$PKG/src/bridge.test.ts" "$V"
[ "$MID" != none ] && python3 $SP/mut/mutate.py "$WT" "$MID"
(cd "$PKG" && npx vitest run src/bridge.test.ts -t "retains a detached session whose only work" --reporter=json --outputFile="$OUT/var-$V-$MID.json" > "$OUT/var-$V-$MID.log" 2>&1)
node -e '
const r=require(process.argv[1]); let s=[];
for (const f of r.testResults) for (const a of f.assertionResults) if (a.status!=="skipped" && a.status!=="pending") s.push(a.status + " " + (a.failureMessages[0]||"").split("\n")[0].slice(0,90) + " " + (((a.failureMessages[0]||"").match(/bridge\.test\.ts:\d+/)||[""])[0]));
console.log(process.argv[2].padEnd(24), process.argv[3].padEnd(22), s.join(" | "));
' "$OUT/var-$V-$MID.json" "$V" "$MID"
