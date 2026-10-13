#!/bin/bash
# D3 control: the same Harness outage with NO cancel — what does a restart do to each kind on its own?
DB=$1; ID=$2; DOWN=$3; source ./lib.sh
PW=$(newp "PARENT::wfbg::${ID}w::hold Run the workflow."); PA=$(newp "PARENT::bg::${ID}a::hold Launch.")
for i in $(seq 120); do n=$(grep -c -E "child-holding\",\"child\":\"CHILD::hold::${ID}(wh|a)\"" runs/model-requests.jsonl); [ "$n" -ge 2 ] && break; sleep 1; done
sleep 3; TW=$(ktask $PW workflow); TA=$(ktask $PA child_agent)
CW=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$PW'"); CA=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$PA'")
echo "== D3ctl [$DB] down=${DOWN}s (no cancel)  wf=$PW  agent=$PA"
echo "   $(date -u +%T) kill harness: $(node stack.mjs stop $DB harness | tail -1)"; sleep $DOWN
echo "   $(date -u +%T) restart harness: $(node stack.mjs harness $DB | tail -1)"
for k in $(seq 36); do sleep 5; w=$(lastturn $CW); a=$(lastturn $CA); [[ ! "$w" =~ ^RUNNING && ! "$a" =~ ^RUNNING ]] && break; done
echo "   $(date -u +%T) workflow child turn: $w  task $(tstate $PW $TW)"
echo "   $(date -u +%T) agent child turn:    $a  task $(tstate $PA $TA)"
sq "SELECT LEFT(error_message,160) FROM managed_agent_turn WHERE session_id='$CW' ORDER BY created_at DESC LIMIT 1" | sed 's/^/   wf error: /'
release ${ID}wh; sleep 20; echo "   $(date -u +%T) after release: agent child $(lastturn $CA) task $(tstate $PA $TA); release agent"; release ${ID}a; sleep 15
echo "   $(date -u +%T) final: workflow $(tstate $PW $TW) | agent $(tstate $PA $TA) child $(lastturn $CA)"
