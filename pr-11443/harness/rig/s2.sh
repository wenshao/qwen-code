#!/usr/bin/env bash
# s2.sh <tree> <case-label> <textDocumentSync-json|absent>
set -u
R=/root/git/pr11443-e2e; TREE=$1; CASE=$2; SYNC=$3
WS=$R/ws-fake-$CASE; rm -rf $WS; mkdir -p $WS/src
printf 'alpha one\nbeta\n' > $WS/src/doc.txt
cat > $WS/.lsp.json <<JSON
{ "plaintext": { "command": "$R/rig/fake-lsp.mjs", "extensionToLanguage": { "txt": "plaintext" },
  "env": { "FAKE_SYNC": $(jq -Rn --arg s "$SYNC" '$s'), "FAKE_LOG": "$R/out/s2-$TREE-$CASE.fake.jsonl" } } }
JSON
H='{"operation":"hover","filePath":"src/doc.txt","line":1,"character":1}'
cat > $R/out/s2-$CASE.prompt <<P
capability case $CASE
@@tool lsp $H
@@tool run_shell_command {"command":"printf 'alpha TWO\\\\nbeta\\\\n' > src/doc.txt","description":"edit 1"}
@@tool lsp $H
@@tool lsp $H
@@tool run_shell_command {"command":"printf 'alpha THREE\\\\nbeta\\\\n' > src/doc.txt","description":"edit 2"}
@@tool lsp $H
@@tool lsp $H
P
rm -f $R/out/s2-$TREE-$CASE.fake.jsonl
$R/rig/run.sh $TREE $WS s2-$TREE-$CASE $R/out/s2-$CASE.prompt
jq -r '.[] | select(.type=="result") | .result' $R/out/s2-$TREE-$CASE.json | grep -E '^\[[0-9]+\] hover' -A1 | grep -v '^--' | paste - - | sed 's/Hover for src\/doc.txt:1:1://'
echo "  wire(server-side):"; jq -rc '"    \(.m) v=\(.version // "-") known=\(.known // "-") \(if .changes then (.changes|map(if .range then "range" else "full" end)|join(",")) else "" end)"' $R/out/s2-$TREE-$CASE.fake.jsonl
