#!/bin/bash
# D3 pair: one workflow parent and one child_agent parent, both held, through ONE Harness outage.
#    usage: pD3pair.sh <db> <id> <downSec>
DB=$1; ID=$2; DOWN=$3; source ./lib.sh
PW=$(newp "PARENT::wfbg::${ID}w::hold Run the workflow."); PA=$(newp "PARENT::bg::${ID}a::hold Launch.")
for i in $(seq 120); do n=$(grep -c -E "child-holding\",\"child\":\"CHILD::hold::${ID}(wh|a)\"" runs/model-requests.jsonl); [ "$n" -ge 2 ] && break; sleep 1; done
sleep 3; TW=$(ktask $PW workflow); TA=$(ktask $PA child_agent)
CW=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$PW'"); CA=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$PA'")
echo "== D3pair [$DB] down=${DOWN}s  wf=$PW  agent=$PA"
echo "   $(date -u +%T) kill harness: $(node stack.mjs stop $DB harness | tail -1)"; sleep 2
echo "   $(date -u +%T) cancel wf -> $(node client.mjs $DB taskcancelk $PW $TW k-$ID-w | cut -c1-90)"
echo "   $(date -u +%T) cancel ag -> $(node client.mjs $DB taskcancelk $PA $TA k-$ID-a | cut -c1-90)"
sleep $DOWN; echo "   $(date -u +%T) restart harness: $(node stack.mjs harness $DB | tail -1)"; R0=$(date +%s)
dw=; da=; cw=; ca=
for k in $(seq 200); do
  sleep 1; now=$(( $(date +%s) - R0 ))
  [ -z "$dw" ] && [ "$(sq "SELECT state FROM managed_agent_operation WHERE session_id='$PW'")" = COMPLETED ] && dw=$now
  [ -z "$da" ] && [ "$(sq "SELECT state FROM managed_agent_operation WHERE session_id='$PA'")" = COMPLETED ] && da=$now
  [ -z "$cw" ] && [[ "$(tstate $PW $TW)" =~ ^cancelled ]] && cw=$now
  [ -z "$ca" ] && [[ "$(tstate $PA $TA)" =~ ^cancelled ]] && ca=$now
  [ -n "$cw" ] && [ -n "$ca" ] && break
done
echo "   seconds after restart: workflow op=${dw:-never} task-cancelled=${cw:-never} | child_agent op=${da:-never} task-cancelled=${ca:-never}"
for C in $CW $CA; do echo "   child $C turn: $(lastturn $C)"; grep -F "$C" runs/$DB/spring.log | grep "will retry" | tail -2 | sed 's/.*retry=/     retry=/' | cut -c1-120; done
release ${ID}wh; release ${ID}a
