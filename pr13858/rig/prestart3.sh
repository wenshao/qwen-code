#!/bin/bash
# Deterministic window: kill the Harness once the child exists and its model call is held (mid-script / mid-turn).
# usage: prestart3.sh <db> <id> <wffg|fg>   (wffg holds CHILD::hold::<id>h, fg holds CHILD::hold::<id>)
DB=$1; ID=$2; MODE=$3; source ./lib.sh
KEY=$ID; [[ "$MODE" == wf* ]] && KEY=${ID}h
P=$(newp "PARENT::$MODE::$ID::hold Run it."); echo "parent $P ($MODE)"
for i in $(seq 240); do grep -q "child-holding\",\"child\":\"CHILD::hold::${KEY}\"" runs/model-requests.jsonl 2>/dev/null && break; sleep 0.5; done
echo "   at kill: child_runs=$(childruns $P) children=$(sq "SELECT COUNT(*) FROM managed_agent_session WHERE parent_session_id='$P'") held=$(grep -c "child-holding\",\"child\":\"CHILD::hold::${KEY}\"" runs/model-requests.jsonl)"
restart 2
sleep 3; release $KEY
echo "   final: $(waitterm $P 150)"
turns $P; ledger $P
python3 toolres.py $DB $P | cut -c1-200
