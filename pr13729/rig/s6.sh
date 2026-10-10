#!/bin/bash
# S1: headless replacement after a conversation-only rewind (the PR's claim),
# plus a control: an ordinary edit turn's code-only restore still works.
# Usage: s1.sh <arm>   (arm = main | merge)
set -u
source /Users/wenshao/pr13729-rig/lib.sh
ARM=$1; TGT=$2; TAG=$(echo "$TGT" | sed "s/MARK_/t/" | tr A-Z a-z); S=s6$ARM-$TAG
setup_run "$ARM" s6$TAG || exit 1
echo "$BASE" > "$RUN/base.txt"
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RUN/steps.log"; }
open_selector() {
  tm send-keys -t "$1" Escape; sleep 0.2; tm send-keys -t "$1" Escape
  wait_for "$1" "Rewind Conversation" 15
  sleep 0.5
}
prompt() {
  tm send-keys -t "$1" -l "$2"; sleep 0.5; tm send-keys -t "$1" Enter
  wait_for "$1" "$3" 90
}

# Phase A: interactive turns 0,1 no-edit; turn 2 edits; conversation-only rewind to turn 2.
tm new-session -d -s "$S" -x 180 -y 48 -c "$WS" "$(cli_env) node $RIG/$ARM/dist/cli.js $(cli_args)"
wait_for "$S" "Type your message" 60 || exit 1; sleep 1
prompt "$S" "MARK_A plain question one" "MARK_A acknowledged" || exit 1
prompt "$S" "MARK_B plain question two" "MARK_B acknowledged" || exit 1
prompt "$S" "MARK_C EDIT_STATE:OLD_EDIT" "MARK_C done" || exit 1
log "A: after edit turn state.txt=$(cat "$WS/state.txt")"
open_selector "$S" || exit 1
cap "$S" a1-selector
tm send-keys -t "$S" Enter; wait_for "$S" "Restore conversation only" 15 || exit 1; sleep 1
cap "$S" a2-options-edit-turn
tm send-keys -t "$S" Down; sleep 0.3; tm send-keys -t "$S" Enter
wait_for "$S" "Conversation rewound" 15 || exit 1; sleep 1
cap "$S" a3-conversation-rewound
log "A: after conversation-only rewind state.txt=$(cat "$WS/state.txt")"
tm send-keys -t "$S" C-u; sleep 0.3; tm send-keys -t "$S" -l "/quit"; sleep 0.4; tm send-keys -t "$S" Enter
for i in $(seq 1 40); do tm has-session -t "$S" 2>/dev/null || break; sleep 0.25; done
TR=$(ls "$H"/.qwen/projects/*/chats/*.jsonl); SID=$(basename "$TR" .jsonl); echo "$SID" > "$RUN/sid.txt"
cp "$TR" "$RUN/transcript-after-rewind.jsonl"

# Phase B: ACP stdio session/load + one text-only prompt.
node "$RIG/acp-probe3.mjs" "$RIG/$ARM/dist/cli.js" "$WS" "$H" "$BASE" "$SID" "$RUN/acp.json" "$TGT" > "$RUN/acp.console" 2>&1
log "B: acp result: $(tr -d '\n' < "$RUN/acp.json" | cut -c1-300)"
cp "$TR" "$RUN/transcript-final.jsonl"
log "B: minted: $(python3 "$RIG/ordinals.py" "$TR" | grep MARK_F)"
kill "$MOCKPID" 2>/dev/null
log "DONE"
