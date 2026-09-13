#!/usr/bin/env bash
# run.sh <arm: base|head|noclamp> <scenario> <label> [settings-overlay.json]
# Headless real CLI against the mock. noclamp = head build with the aee22dfbfd
# clamp removed from compiled shell.js (== 8ac6e4d602's shell.ts); patched
# in place for the run and restored + sha-checked afterwards.
set -euo pipefail
H=/root/git/h11727
arm=$1 scen=$2 label=$3 overlay=${4:-}
case $arm in
  base) TREE=/root/git/b11727 ;;
  head|noclamp|nohalfcap) TREE=/root/git/pr11727 ;;
  *) echo "bad arm"; exit 2 ;;
esac
SHELLJS=$TREE/packages/core/dist/src/tools/shell.js
# Round 3 (head fd61c750b0): whitespace-tolerant regex patches of compiled shell.js.
#   nohalfcap = drop the half-cap only        (== c2d3c24df8 reservation semantics)
#   noclamp   = drop the clamp AND the half-cap (== 8ac6e4d602)
PATCH_RE= PATCH_TO=
case $arm in
  nohalfcap) PATCH_RE='Math\.min\(appendedMetadataChars,\s*Math\.floor\(outputThreshold \/ 2\)\)'; PATCH_TO='appendedMetadataChars' ;;
  noclamp) PATCH_RE='Math\.max\(1,\s*outputThreshold\s*-\s*Math\.min\(appendedMetadataChars,\s*Math\.floor\(outputThreshold \/ 2\)\)\)'; PATCH_TO='(outputThreshold - appendedMetadataChars)' ;;
esac
if [ -n "$PATCH_RE" ]; then
  cp "$SHELLJS" "$H/shell.js.orig"
  node -e 'const fs=require("fs");const [f,a,b]=process.argv.slice(1);const s=fs.readFileSync(f,"utf8");const re=new RegExp(a,"g");const n=(s.match(re)||[]).length;if(n!==1){console.error("matches="+n);process.exit(4)}fs.writeFileSync(f,s.replace(re,()=>b))' "$SHELLJS" "$PATCH_RE" "$PATCH_TO" || { echo "mutant not applied"; exit 3; }
  trap 'cp "$H/shell.js.orig" "$SHELLJS"; sha256sum "$SHELLJS" | cut -c1-16 > "$H/out/$label/restored.sha"' EXIT
fi
HOMEDIR=$H/homes/$label
rm -rf "$HOMEDIR" "$H/out/$label"; mkdir -p "$HOMEDIR/.qwen" "$H/out/$label" "$H/ws"
node -e '
const fs=require("fs");
const s={security:{auth:{selectedType:"openai"}},general:{disableAutoUpdate:true},privacy:{usageStatisticsEnabled:false}};
const o=process.argv[2]?JSON.parse(fs.readFileSync(process.argv[2],"utf8")):{};
const merge=(a,b)=>{for(const k in b){a[k]=(b[k]&&typeof b[k]==="object"&&!Array.isArray(b[k]))?merge(a[k]||{},b[k]):b[k]}return a};
fs.writeFileSync(process.argv[1],JSON.stringify(merge(s,o),null,1));
' "$HOMEDIR/.qwen/settings.json" "$overlay"
cd "$H/ws"
start=$(date +%s.%N)
env -i PATH="$PATH" HOME="$HOMEDIR" TERM=dumb \
  OPENAI_API_KEY=mock OPENAI_BASE_URL=http://127.0.0.1:18727/v1 OPENAI_MODEL=mock-model \
  timeout 180 node "$TREE/packages/cli/dist/index.js" --approval-mode yolo \
  -p "[[S:$scen]] [[L:$label]] run the scenario" > "$H/out/$label/stdout.txt" 2> "$H/out/$label/stderr.txt" || echo "cli exit $?" >> "$H/out/$label/stderr.txt"
end=$(date +%s.%N)
echo "$label ($(awk -v a="$start" -v b="$end" 'BEGIN{printf "%.1f", b-a}')s): $(tail -1 "$H/out/$label/stdout.txt")"
