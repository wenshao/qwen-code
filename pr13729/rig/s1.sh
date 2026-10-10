#!/bin/bash
# S1: headless replacement after a conversation-only rewind (the PR's claim),
# plus a control: an ordinary edit turn's code-only restore still works.
# Usage: s1.sh <arm>   (arm = main | merge)
set -u
source /Users/wenshao/pr13729-rig/lib.sh
ARM=$1; S=s1$ARM
setup_run "$ARM" s1 || exit 1
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

# Phase B: headless text-only replacement.
tm new-session -d -s "${S}B" -x 180 -y 20 -c "$WS" "$(cli_env) QWEN_CODE_SUPPRESS_YOLO_WARNING=1 node $RIG/$ARM/dist/cli.js $(cli_args) --resume $SID -p 'MARK_D replacement text-only' > $RUN/headless.out 2>&1; echo EXIT=\$? >> $RUN/headless.out"
for i in $(seq 1 240); do grep -q EXIT= "$RUN/headless.out" 2>/dev/null && break; sleep 0.5; done
log "B: headless: $(tr '\n' ' ' < "$RUN/headless.out") state.txt=$(cat "$WS/state.txt")"
cp "$TR" "$RUN/transcript-after-headless.jsonl"

# Phase C: interactive resume; selector offer for the replacement turn.
tm new-session -d -s "${S}C" -x 180 -y 48 -c "$WS" "$(cli_env) node $RIG/$ARM/dist/cli.js $(cli_args) --resume $SID"
wait_for "${S}C" "Type your message" 60 || exit 1; sleep 2
open_selector "${S}C" || exit 1
cap "${S}C" c1-selector
tm send-keys -t "${S}C" Enter; wait_for "${S}C" "Restore conversation only" 15 || exit 1; sleep 1.5
cap "${S}C" c2-options-replacement
if grep -q "Restore code only" "$RUN/caps/c2-options-replacement.txt"; then
  log "C: replacement turn OFFERS code restore -> executing Restore code only"
  tm send-keys -t "${S}C" Down; sleep 0.3; tm send-keys -t "${S}C" Down; sleep 0.3
  tm send-keys -t "${S}C" Enter
  wait_for "${S}C" "Restored|rror" 20; sleep 1.5
  cap "${S}C" c3-after-code-restore
else
  log "C: replacement turn offers NO code restore -> Never mind"
  tm send-keys -t "${S}C" Escape; sleep 0.4; tm send-keys -t "${S}C" Escape; sleep 1
  cap "${S}C" c3-no-restore-offered
fi
log "C: state.txt=$(cat "$WS/state.txt")"

# Phase D (control): an ordinary edit turn's code-only restore still works.
tm send-keys -t "${S}C" C-u; sleep 0.3
prompt "${S}C" "MARK_E EDIT_STATE:CTRL_EDIT" "MARK_E done" || exit 1
log "D: after control edit state.txt=$(cat "$WS/state.txt")"
open_selector "${S}C" || exit 1
tm send-keys -t "${S}C" Enter; wait_for "${S}C" "Restore conversation only" 15 || exit 1; sleep 1.5
cap "${S}C" d1-options-control
tm send-keys -t "${S}C" Down; sleep 0.3; tm send-keys -t "${S}C" Down; sleep 0.3; tm send-keys -t "${S}C" Enter
wait_for "${S}C" "Restored|rror" 20; sleep 1.5
cap "${S}C" d2-after-control-restore
log "D: after control code-only restore state.txt=$(cat "$WS/state.txt")"
tm send-keys -t "${S}C" C-u; sleep 0.3; tm send-keys -t "${S}C" -l "/quit"; sleep 0.4; tm send-keys -t "${S}C" Enter
for i in $(seq 1 40); do tm has-session -t "${S}C" 2>/dev/null || break; sleep 0.25; done
cp "$TR" "$RUN/transcript-final.jsonl"
kill "$MOCKPID" 2>/dev/null
log "DONE"
