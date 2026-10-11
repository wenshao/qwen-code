#!/bin/bash
# B3: close the parent while its workflow child is mid-script (agent() held). usage: pclose.sh <db> <id> <wfbg|wffg>
DB=$1; ID=$2; MODE=${3:-wfbg}; source ./lib.sh
P=$(newp "PARENT::$MODE::$ID::hold Run the workflow."); echo "parent $P ($MODE)"
for i in $(seq 120); do grep -q "\"role\":\"child-holding\",\"child\":\"CHILD::hold::${ID}h\"" runs/model-requests.jsonl 2>/dev/null && break; sleep 1; done
echo "   held at $(date -u +%T): $(grep -c "child-holding.*CHILD::hold::${ID}h" runs/model-requests.jsonl) subagent request(s)"
kids $P; turns $P; ledger $P
echo "   close -> $(node client.mjs $DB close $P | cut -c1-220)"
for i in $(seq 90); do s=$(sst $P); c=$(sq "SELECT GROUP_CONCAT(status) FROM managed_agent_session WHERE parent_session_id='$P'"); [[ "$s" == CLOSED && "$c" == CLOSED ]] && break; sleep 2; done
echo "   after close ($(date -u +%T)): parent=$(sst $P)"
kids $P; turns $P; ledger $P
release ${ID}h
