#!/usr/bin/env bash
# tui.sh <arm: base|head|noclamp> <scenario> <label> [overlay.json]
# Real interactive CLI in tmux -L pr11727; types the scenario prompt, waits for the
# mock's "MODEL RECEIVED" reply to render, captures the pane with ANSI colour.
set -uo pipefail
H=/root/git/h11727
arm=$1 scen=$2 label=$3 overlay=${4:-}
nap() { perl -e "select(undef,undef,undef,$1)"; }
case $arm in
  base) TREE=/root/git/b11727 ;;
  head|noclamp|nohalfcap) TREE=/root/git/pr11727 ;;
esac
SHELLJS=$TREE/packages/core/dist/src/tools/shell.js
T="tmux -L pr11727"
PATCH_RE= PATCH_TO=
case $arm in
  nohalfcap) PATCH_RE='Math\.min\(appendedMetadataChars,\s*Math\.floor\(outputThreshold \/ 2\)\)'; PATCH_TO='appendedMetadataChars' ;;
  noclamp) PATCH_RE='Math\.max\(1,\s*outputThreshold\s*-\s*Math\.min\(appendedMetadataChars,\s*Math\.floor\(outputThreshold \/ 2\)\)\)'; PATCH_TO='(outputThreshold - appendedMetadataChars)' ;;
esac
cleanup() {
  $T kill-session -t tui 2>/dev/null
  if [ -n "$PATCH_RE" ]; then cp "$H/shell.js.orig" "$SHELLJS"; fi
}
if [ -n "$PATCH_RE" ]; then
  cp "$SHELLJS" "$H/shell.js.orig"
  node -e 'const fs=require("fs");const [f,a,b]=process.argv.slice(1);const s=fs.readFileSync(f,"utf8");const re=new RegExp(a,"g");const n=(s.match(re)||[]).length;if(n!==1){console.error("matches="+n);process.exit(4)}fs.writeFileSync(f,s.replace(re,()=>b))' "$SHELLJS" "$PATCH_RE" "$PATCH_TO" || { echo "mutant not applied"; exit 3; }
fi
trap cleanup EXIT
HOMEDIR=$H/homes/$label
rm -rf "$HOMEDIR" "$H/out/$label"; mkdir -p "$HOMEDIR/.qwen" "$H/out/$label" "$H/ws"
node -e '
const fs=require("fs");
const s={security:{auth:{selectedType:"openai"},folderTrust:{enabled:false}},general:{disableAutoUpdate:true},privacy:{usageStatisticsEnabled:false},ui:{hideTips:true}};
const o=process.argv[2]?JSON.parse(fs.readFileSync(process.argv[2],"utf8")):{};
const merge=(a,b)=>{for(const k in b){a[k]=(b[k]&&typeof b[k]==="object"&&!Array.isArray(b[k]))?merge(a[k]||{},b[k]):b[k]}return a};
fs.writeFileSync(process.argv[1],JSON.stringify(merge(s,o),null,1));
' "$HOMEDIR/.qwen/settings.json" "$overlay"
$T kill-session -t tui 2>/dev/null
$T new-session -d -s tui -x 150 -y 46 -c "$H/ws" \
  "env -i PATH=$PATH HOME=$HOMEDIR TERM=xterm-256color COLORTERM=truecolor OPENAI_API_KEY=mock OPENAI_BASE_URL=http://127.0.0.1:18727/v1 OPENAI_MODEL=mock-model node $TREE/packages/cli/dist/index.js --approval-mode yolo; read -r _"
for i in $(seq 1 120); do
  $T capture-pane -t tui -p | grep -qiE 'type your message|>\s*$' && break
  nap 0.5
done
nap 1.5
$T capture-pane -t tui -e -p > "$H/out/$label/pane-ready.ansi"
$T send-keys -t tui -l "[[S:$scen]] [[L:$label]] run the scenario"
nap 0.5
$T send-keys -t tui Enter
for i in $(seq 1 240); do
  [ -f "$H/out/$label/summary.json" ] && $T capture-pane -t tui -p | grep -q 'MODEL RECEIVED' && break
  nap 0.5
done
nap 2
$T capture-pane -t tui -e -p > "$H/out/$label/pane.ansi"
echo "$label: $(cat "$H/out/$label/summary.json" 2>/dev/null | tr -d '\n ' | cut -c1-200)"
