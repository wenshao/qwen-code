#!/usr/bin/env bash
# s6.sh <tree> — R4-1: reload while a URI is pending-only (parked in replayUris, not re-delivered).
set -u
R=/root/git/pr11443-e2e; TREE=$1
WS=$R/ws-s6-$TREE; rm -rf $WS; mkdir -p $WS/src
printf 'alpha one\n' > $WS/src/a.txt; printf 'bravo one\n' > $WS/src/b.txt
FL=$R/out/s6-$TREE.fake.jsonl; rm -f $FL
cat > $WS/.lsp.json <<JSON
{ "plaintext": { "command": "$R/rig/fake-lsp.mjs", "extensionToLanguage": { "txt": "plaintext" }, "restartOnCrash": true,
  "env": { "FAKE_SYNC": "2", "FAKE_LOG": "$FL" } } }
JSON
HA='{"operation":"hover","filePath":"src/a.txt","line":1,"character":1}'
HB='{"operation":"hover","filePath":"src/b.txt","line":1,"character":1}'
RELOAD="printf 'bravo AFTER-RELOAD\\\\n' > src/b.txt; node -e \\\"const f='.lsp.json',fs=require('fs'),j=JSON.parse(fs.readFileSync(f));j.plaintext.env.RELOAD='1';fs.writeFileSync(f,JSON.stringify(j))\\\"; sleep 7; echo MARK-AFTER-RELOAD >> $FL"
cat > $R/out/s6-$TREE.prompt <<P
pending-only replay across reload
@@tool lsp $HA
@@tool lsp $HB
@@tool run_shell_command {"command":"kill \$(jq -r .pid $FL | tail -1); sleep 4","description":"crash server"}
@@tool lsp $HA
@@tool run_shell_command {"command":"$RELOAD","description":"edit b.txt + change .lsp.json (restart)"}
@@tool lsp {"operation":"workspaceDiagnostics"}
P
QWEN_DEBUG_LOG_FILE=1 $R/rig/run.sh $TREE $WS s6-$TREE $R/out/s6-$TREE.prompt
jq -r '.[] | select(.type=="result") | .result' $R/out/s6-$TREE.json | grep -E '^\[(4|6)\]' -A5 | grep -E '^\[|WARNING|failed'
echo "  server-side:"; sed 's/^MARK-AFTER-RELOAD$/{"m":"----- 7s after .lsp.json edit, before next query -----"}/' $FL | jq -rc '"    pid=\(.pid // "") \(.m) \(.uri // "" | split("/") | last) v=\(.version // "") \(.knownDocs // "")"'
