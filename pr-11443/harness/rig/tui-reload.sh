#!/usr/bin/env bash
# tui-reload.sh <tree> — long-lived TUI; an external .lsp.json edit restarts the server,
# and the fake server log shows whether tracked documents are replayed to the new process.
set -u
R=/root/git/pr11443-e2e; TREE=$1; SOCK="tmux -L pr11443"; S=reload-$TREE
case $TREE in pr) CLI=/root/git/pr11443/dist/cli.js;; base) CLI=/root/git/pr11443-base/dist/cli.js;; esac
WS=$R/ws-reload-$TREE; rm -rf $WS; mkdir -p $WS/src
printf 'alpha one\nbeta\n' > $WS/src/doc.txt; printf 'other one\n' > $WS/src/other.txt
FL=$R/out/reload-$TREE.fake.jsonl; rm -f $FL
cat > $WS/.lsp.json <<JSON
{ "plaintext": { "command": "$R/rig/fake-lsp.mjs", "extensionToLanguage": { "txt": "plaintext" },
  "env": { "FAKE_SYNC": "2", "FAKE_LOG": "$FL" } } }
JSON
H=$R/home-tui-$TREE; mkdir -p $H/.qwen
echo '{ "security": { "auth": { "selectedType": "openai" } }, "model": { "name": "mock-lsp" } }' > $H/.qwen/settings.json
$SOCK kill-session -t $S 2>/dev/null
$SOCK new-session -d -s $S -x 110 -y 50 "env HOME=$H OPENAI_API_KEY=mock OPENAI_BASE_URL=http://127.0.0.1:18443/v1 OPENAI_MODEL=mock-lsp QWEN_RUNTIME_DIR=$R/runtime-reload-$TREE QWEN_DEBUG_LOG_FILE=1 bash -c 'cd $WS && node $CLI --experimental-lsp --approval-mode yolo; sleep 900'"
for i in $(seq 1 60); do sleep 1; $SOCK capture-pane -t $S -p | grep -q "Type your message" && break; done
send() {
  local before; before=$($SOCK capture-pane -t $S -p -S -400 | grep -c '^ *✦\|^ *✕\|\[1\] ')
  $SOCK send-keys -t $S -l "$1"; sleep 0.6; $SOCK send-keys -t $S Enter
  for i in $(seq 1 45); do
    sleep 1
    local pane; pane=$($SOCK capture-pane -t $S -p -S -400)
    if ! grep -q "esc to cancel" <<<"$pane" && [ "$(grep -c '^ *✦\|^ *✕\|\[1\] ' <<<"$pane")" -gt "$before" ]; then sleep 1; return; fi
  done
  echo "timeout waiting on: $1"
}
send '@@tool lsp {"operation":"hover","filePath":"src/doc.txt","line":1,"character":1}'
send '@@tool lsp {"operation":"hover","filePath":"src/other.txt","line":1,"character":1}'
# External writer + config edit, outside the CLI process.
printf 'alpha AFTER-RELOAD\nbeta\n' > $WS/src/doc.txt
node -e "const f='$WS/.lsp.json',fs=require('fs'),j=JSON.parse(fs.readFileSync(f));j.plaintext.env.RELOAD='1';fs.writeFileSync(f,JSON.stringify(j,null,2))"
for i in $(seq 1 20); do sleep 1; [ "$(jq -r .pid $FL | sort -u | wc -l)" -gt 1 ] && break; done
sleep 3
echo "--- server log right after reload (before any new query):"
jq -rc '"  pid=\(.pid) \(.m) \(.uri // "" | split("/") | last) v=\(.version // "-")"' $FL
send '@@tool lsp {"operation":"workspaceDiagnostics"}'
send '@@tool lsp {"operation":"hover","filePath":"src/doc.txt","line":1,"character":1}'
$SOCK capture-pane -t $S -e -p -S -400 > $R/out/reload-$TREE.ansi
echo "--- full server log:"
jq -rc '"  pid=\(.pid) \(.m) \(.uri // "" | split("/") | last) v=\(.version // "-") \(.knownDocs // "")"' $FL
$SOCK kill-session -t $S
