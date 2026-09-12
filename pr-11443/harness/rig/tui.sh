#!/usr/bin/env bash
# tui.sh <tree> — real interactive TUI in tmux -L pr11443; captures ANSI after key steps.
set -u
R=/root/git/pr11443-e2e; TREE=$1; SOCK="tmux -L pr11443"; S=tui-$TREE
case $TREE in pr) CLI=/root/git/pr11443/dist/cli.js;; base) CLI=/root/git/pr11443-base/dist/cli.js;; esac
WS=$R/ws-tui-$TREE; rm -rf $WS; cp -r $R/ws-ts $WS; printf 'let value: number = 42;\nvalue;\n' > $WS/src/sample.ts
H=$R/home-tui-$TREE; mkdir -p $H/.qwen
echo '{ "security": { "auth": { "selectedType": "openai" } }, "model": { "name": "mock-lsp" } }' > $H/.qwen/settings.json
$SOCK kill-session -t $S 2>/dev/null
$SOCK new-session -d -s $S -x 110 -y 60 "env HOME=$H OPENAI_API_KEY=mock OPENAI_BASE_URL=http://127.0.0.1:18443/v1 OPENAI_MODEL=mock-lsp QWEN_RUNTIME_DIR=$R/runtime-tui-$TREE LSP_WIRE_LOG=$R/out/tui-$TREE.wire.jsonl bash -c 'cd $WS && node $CLI --experimental-lsp --approval-mode yolo; sleep 900'"
cap() { $SOCK capture-pane -t $S -e -p -S -400 > $R/out/tui-$TREE-$1.ansi; }
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
W="node $R/rig/writer.mjs src/sample.ts"
send '@@tool lsp {"operation":"hover","filePath":"src/sample.ts","line":2,"character":1}'
send "@@tool run_shell_command {\"command\":\"$W equal\",\"description\":\"rewrite: number -> string (same size, same mtime)\"}"
send '@@tool lsp {"operation":"hover","filePath":"src/sample.ts","line":2,"character":1}'
cap 1-hover
$SOCK send-keys -t $S C-l 2>/dev/null
send "@@tool run_shell_command {\"command\":\"$W moved\",\"description\":\"move the declaration down two lines\"}"
send '@@tool lsp {"operation":"goToDefinition","filePath":"src/sample.ts","line":4,"character":1}'
send '@@tool run_shell_command {"command":"rm src/sample.ts","description":"delete the opened file"}'
send '@@tool lsp {"operation":"diagnostics","filePath":"src/sample.ts"}'
cap 2-def-diag
echo "captured tui-$TREE"
