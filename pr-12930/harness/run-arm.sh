#!/bin/bash
# Usage: run-arm.sh <arm: base|head> <fault> <tag> [full]
# Runs the SIGKILL test (or the full file with "full") once, retry=0, and
# appends one TSV result line to results.tsv.
set -u
ARM=$1; FAULT=$2; TAG=$3; SCOPE=${4:-sigkill}
ROOT=/root/verify/pr12930
WT=$ROOT/qwen-code-pr12930
OUT=$ROOT/runs/$TAG; mkdir -p "$OUT"
case $ARM in
  base) FILE=cli/armbase-serve-streaming.test.ts ;;
  head) FILE=cli/qwen-serve-streaming.test.ts ;;
esac
FILTER=(); [ "$SCOPE" = sigkill ] && FILTER=(-t "SIGKILL")
LOG=$OUT/timeline.jsonl; : > "$LOG"
cd $WT
start=$(date +%s%3N)
PR12930_FAULT=$FAULT PR12930_LOG=$LOG NODE_OPTIONS="--require $ROOT/harness/fault.cjs" \
  QWEN_SANDBOX=false CI=true \
  ${WRAP:-} timeout 300 npx vitest run --root ./integration-tests "$FILE" "${FILTER[@]}" --retry=0 \
  --reporter=default --reporter=json --outputFile.json=$OUT/report.json > $OUT/stdout.txt 2>&1
rc=$?
end=$(date +%s%3N)
summary=$(node -e '
const r=require(process.argv[1]);
const out=[];
for (const f of r.testResults) for (const a of f.assertionResults) {
  if (a.status==="pending"||a.status==="skipped") continue;
  out.push(a.status+":"+Math.round(a.duration||0)+"ms:"+(a.failureMessages[0]||"").split("\n")[0].slice(0,160).replace(/\t/g," "));
}
console.log(out.join(" | "));' $OUT/report.json 2>/dev/null)
printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$TAG" "$ARM" "$FAULT" "$SCOPE" "$rc" "$((end-start))" "$summary" >> $ROOT/results.tsv
echo "$TAG $ARM $FAULT rc=$rc $summary"
