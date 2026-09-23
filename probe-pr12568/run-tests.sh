#!/bin/bash
# run-tests.sh <label> <tempdir>
LABEL=$1; T=$2; mkdir -p "$T"; OUT=$GITHUB_WORKSPACE/probe-out; mkdir -p "$OUT"
cd "$GITHUB_WORKSPACE/packages/cli"
TEMP="$T" TMP="$T" NO_COLOR=1 node ../../node_modules/vitest/vitest.mjs run src/serve/conversations/standalone-deletion-journal.test.ts src/commands/review/lib/same-file.test.ts src/commands/review/findings.test.ts src/commands/review/repo-context.test.ts src/commands/review/save-artifact.test.ts --coverage.enabled=false > "$OUT/test-$LABEL.txt" 2>&1
RC=$?
SUM=$(grep -E '^ +Tests ' "$OUT/test-$LABEL.txt" | tail -1 | sed 's/^ *//')
FAILED=$(grep -E '^ +×' "$OUT/test-$LABEL.txt" | sed 's/^ *× //; s/ [0-9]*ms$//' | head -12 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(s.trim().split("\n").filter(Boolean))))')
SKIPPED=$(grep -cE '^ +↓' "$OUT/test-$LABEL.txt")
MSG=$(grep -E 'resolved "|not to be|AssertionError' "$OUT/test-$LABEL.txt" | sort -u | head -4 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(s.trim())))')
echo "PROBE_JSON {\"label\":\"$LABEL\",\"temp\":\"$(echo $T | sed 's/\\/\//g')\",\"exit\":$RC,\"summary\":\"$SUM\",\"skippedLines\":$SKIPPED,\"failed\":$FAILED,\"msgs\":$MSG}" | tee -a "$OUT/probe.txt"
