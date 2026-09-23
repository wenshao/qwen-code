#!/bin/bash
# usage: e2e-findings.sh <arm-root> <pose on|off> <workdir>
ARM=$1; POSE=$2; W=$3; S=$(dirname "$0")
rm -rf "$W"; mkdir -p "$W" "$W/home"
cat > "$W/in.json" <<'J'
[{"id":"f1","severity":"Critical","summary":"The retry counter is never reset, so the third attempt is refused.","failureScenario":"A request that fails twice then succeeds leaves attempts at 2; the next unrelated request starts at 2 and is rejected after one failure.","file":"src/retry.ts","line":42,"anchor":"attempts += 1"}]
J
echo 'PREVIOUS-RUN-ARTIFACT' > "$W/findings.json"
ln "$W/findings.json" "$W/anchors.json"
ENV=(HOME="$W/home" PATH="$PATH")
[ "$POSE" = on ] && ENV+=(DYLD_INSERT_LIBRARIES="$S/bigino.dylib" BIGINO_PREFIX="$W" BIGINO_LOG="$W/../bigino-$(basename $W).log")
env -i "${ENV[@]}" node "$ARM/dist/cli.js" review findings --input "$W/in.json" --out "$W/findings.json" --to-anchors "$W/anchors.json" > "$W/stdout" 2> "$W/stderr"
RC=$?
echo "arm=$(basename $ARM) pose=$POSE exit=$RC"
echo "  node sees ino (number): $(env -i "${ENV[@]}" node -e 'const fs=require("fs");const a=fs.statSync(process.argv[1]),b=fs.statSync(process.argv[2]);console.log(a.ino, Number.isSafeInteger(a.ino), "bigint", fs.statSync(process.argv[1],{bigint:true}).ino+"n")' "$W/findings.json" "$W/anchors.json")"
echo "  stderr: $(grep -E 'same file|findings:' "$W/stderr" | head -3 | cut -c1-160)"
echo "  anchors.json starts: $(head -c 60 "$W/anchors.json" | tr '\n' ' ')"
echo "  findings.json starts: $(head -c 60 "$W/findings.json" | tr '\n' ' ')"
