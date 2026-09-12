#!/usr/bin/env bash
# s4.sh <tree> — .lsp.json hot reload restarts the server; tracked docs should be replayed.
set -u
R=/root/git/pr11443-e2e; TREE=$1
WS=$R/ws-s4-$TREE; rm -rf $WS; mkdir -p $WS/src
printf 'alpha one\nbeta\n' > $WS/src/doc.txt; printf 'other one\n' > $WS/src/other.txt
FL=$R/out/s4-$TREE.fake.jsonl; rm -f $FL
cat > $WS/.lsp.json <<JSON
{ "plaintext": { "command": "$R/rig/fake-lsp.mjs", "extensionToLanguage": { "txt": "plaintext" },
  "env": { "FAKE_SYNC": "2", "FAKE_LOG": "$FL" } } }
JSON
H1='{"operation":"hover","filePath":"src/doc.txt","line":1,"character":1}'
H2='{"operation":"hover","filePath":"src/other.txt","line":1,"character":1}'
RELOAD="printf 'alpha AFTER-RELOAD\\\\nbeta\\\\n' > src/doc.txt; node -e \\\"const f='.lsp.json',j=JSON.parse(require('fs').readFileSync(f));j.plaintext.env.RELOAD='1';require('fs').writeFileSync(f,JSON.stringify(j))\\\"; sleep 7"
cat > $R/out/s4-$TREE.prompt <<P
hot reload replay
@@tool lsp $H1
@@tool lsp $H2
@@tool run_shell_command {"command":"$RELOAD","description":"edit doc + change .lsp.json env (restart)"}
@@tool lsp {"operation":"workspaceDiagnostics"}
@@tool lsp $H1
P
$R/rig/run.sh $TREE $WS s4-$TREE $R/out/s4-$TREE.prompt
jq -r '.[] | select(.type=="result") | .result' $R/out/s4-$TREE.json | grep -E '^\[[0-9]+\] (lsp|hover|workspaceDiagnostics|run_shell_command)' -A4 | grep -E '^\[|WARNING|server-copy|Exit Code|Error: [^(]' 
echo "  server-side:"; jq -rc '"    pid=\(.pid) \(.m) \(.uri // "" | split("/") | last) v=\(.version // "-") \(.knownDocs // "")"' $FL
