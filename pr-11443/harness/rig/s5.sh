#!/usr/bin/env bash
# s5.sh <tree> — after a crash, one tracked file is transiently unreadable (EISDIR) during the
# replay sweep; the sibling must still be delivered, and the file must be replayed once readable.
set -u
R=/root/git/pr11443-e2e; TREE=$1
WS=$R/ws-s5-$TREE; rm -rf $WS; mkdir -p $WS/src
printf 'alpha one\nbeta\n' > $WS/src/doc.txt; printf 'other one\n' > $WS/src/other.txt
FL=$R/out/s5-$TREE.fake.jsonl; rm -f $FL
cat > $WS/.lsp.json <<JSON
{ "plaintext": { "command": "$R/rig/fake-lsp.mjs", "extensionToLanguage": { "txt": "plaintext" }, "restartOnCrash": true,
  "env": { "FAKE_SYNC": "2", "FAKE_LOG": "$FL" } } }
JSON
H1='{"operation":"hover","filePath":"src/doc.txt","line":1,"character":1}'
H2='{"operation":"hover","filePath":"src/other.txt","line":1,"character":1}'
cat > $R/out/s5-$TREE.prompt <<P
transient unreadable replay
@@tool lsp $H1
@@tool lsp $H2
@@tool run_shell_command {"command":"kill \$(jq -r .pid $FL | tail -1); sleep 4; rm src/doc.txt; mkdir src/doc.txt; printf 'other AFTER\\\\n' > src/other.txt","description":"crash server; doc.txt becomes a directory"}
@@tool lsp {"operation":"workspaceDiagnostics"}
@@tool run_shell_command {"command":"rmdir src/doc.txt; printf 'alpha RESTORED\\\\nbeta\\\\n' > src/doc.txt","description":"doc.txt readable again"}
@@tool lsp {"operation":"workspaceDiagnostics"}
P
$R/rig/run.sh $TREE $WS s5-$TREE $R/out/s5-$TREE.prompt
jq -r '.[] | select(.type=="result") | .result' $R/out/s5-$TREE.json | grep -E '^\[(4|6)\]' -A6 | grep -E '^\[|WARNING|failed|^src/'
echo "  server-side:"; jq -rc '"    pid=\(.pid) \(.m) \(.uri // "" | split("/") | last) v=\(.version // "-") \(.knownDocs // "")"' $FL
