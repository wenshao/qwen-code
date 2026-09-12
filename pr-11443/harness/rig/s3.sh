#!/usr/bin/env bash
# s3.sh <tree> — crash the LSP server mid-session, edit, then query through replay paths.
set -u
R=/root/git/pr11443-e2e; TREE=$1; CASE=crash
WS=$R/ws-s3-$TREE; rm -rf $WS; mkdir -p $WS/src
printf 'alpha one\nbeta\n' > $WS/src/doc.txt
printf 'other one\n' > $WS/src/other.txt
FL=$R/out/s3-$TREE.fake.jsonl
cat > $WS/.lsp.json <<JSON
{ "plaintext": { "command": "$R/rig/fake-lsp.mjs", "extensionToLanguage": { "txt": "plaintext" }, "restartOnCrash": true,
  "env": { "FAKE_SYNC": "2", "FAKE_LOG": "$FL" } } }
JSON
H1='{"operation":"hover","filePath":"src/doc.txt","line":1,"character":1}'
H2='{"operation":"hover","filePath":"src/other.txt","line":1,"character":1}'
KILL="kill \$(jq -r .pid $FL | tail -1); sleep 4"
cat > $R/out/s3-$TREE.prompt <<P
crash and replay
@@tool lsp $H1
@@tool lsp $H2
@@tool run_shell_command {"command":"$KILL","description":"crash the LSP server"}
@@tool run_shell_command {"command":"printf 'alpha AFTER-CRASH\\\\nbeta\\\\n' > src/doc.txt; printf 'other AFTER-CRASH\\\\n' > src/other.txt","description":"edit both files while server restarts"}
@@tool lsp {"operation":"workspaceDiagnostics"}
@@tool lsp $H2
@@tool lsp $H1
P
rm -f $FL
$R/rig/run.sh $TREE $WS s3-$TREE $R/out/s3-$TREE.prompt
jq -r '.[] | select(.type=="result") | .result' $R/out/s3-$TREE.json | grep -E '^\[[0-9]+\] (hover|workspaceDiagnostics)' -A1 | grep -v '^--' | paste - - | sed 's/Hover for src\///'
echo "  server-side:"; jq -rc '"    pid=\(.pid) \(.m) \(.uri // "" | split("/") | last) v=\(.version // "-") known=\(.known // "-")"' $FL
grep -i "restart\|exited" $R/out/s3-$TREE.stderr | head -3
