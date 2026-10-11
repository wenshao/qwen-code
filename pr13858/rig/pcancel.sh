#!/bin/bash
# Cancel a running workflow child: (turn) its own Turn via the public events API, or (task) the parent's public task cancel.
DB=$1; ID=$2; HOW=$3; source ./lib.sh
P=$(newp "PARENT::wfbg::$ID::hold Run the workflow."); echo "parent $P ($HOW)"
for i in $(seq 120); do grep -q "child-holding\",\"child\":\"CHILD::hold::${ID}h" runs/model-requests.jsonl 2>/dev/null && break; sleep 1; done
C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$P'"); T=$(lastturnid $C)
echo "   child $C turn $T held at $(date -u +%T)"
if [ "$HOW" = turn ]; then echo "   cancel -> $(node client.mjs $DB cancel $C $T | cut -c1-200)"
else TASK=$(node client.mjs $DB tasks $P | grep -o 'task_[0-9a-f]*' | head -1); echo "   task $TASK"; echo "   taskcancel -> $(node client.mjs $DB taskcancel $P $TASK | cut -c1-300)"; fi
for i in $(seq 30); do s=$(lastturn $C); [[ "$s" =~ ^(COMPLETED|FAILED|CANCELLED) ]] && break; sleep 1; done
echo "   child turn after ${i}s: $s"
sleep 6; kids $P; turns $P; ledger $P
release ${ID}h
