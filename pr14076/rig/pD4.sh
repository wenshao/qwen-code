#!/bin/bash
# D4 (owner gone past the delivery budget): Harness down DOWN s -> the cancel parks recovery_blocked;
#    after restart a fresh cancel (new key) must still stop the run.  usage: pD4.sh <db> <id> <downSec>
DB=$1; ID=$2; DOWN=$3; source ./lib.sh
P=$(newp "PARENT::wfbg::$ID::hold Run the workflow."); echo "== D4 [$DB] down=${DOWN}s parent $P"
for i in $(seq 120); do grep -q "child-holding\",\"child\":\"CHILD::hold::${ID}h\"" runs/model-requests.jsonl && break; sleep 1; done
sleep 3; T=$(ktask $P workflow); C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$P'")
echo "   $(date -u +%T) kill harness: $(node stack.mjs stop $DB harness | tail -1)"; sleep 2
R=$(node client.mjs $DB taskcancelk $P $T k-$ID-1); OP=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['json']['id'])"); echo "   $(date -u +%T) cancel -> $OP"
for k in $(seq $((DOWN/20))); do sleep 20; echo "   $(date -u +%T) op=$(sq "SELECT CONCAT(state,'/',IFNULL(error_code,'-'),' attempts=',attempt_count,' claim=',claim_generation) FROM managed_agent_operation WHERE operation_id='$OP'")"; done
echo "   $(date -u +%T) restart harness: $(node stack.mjs harness $DB | tail -1)"; sleep 45
echo "   $(date -u +%T) +45s: GET op -> $(node client.mjs $DB op $P $OP | cut -c1-330)"
echo "   $(date -u +%T) +45s: task $(tstate $P $T); child turn $(lastturn $C)"
echo "   $(date -u +%T) replay k-$ID-1 -> $(node client.mjs $DB taskcancelk $P $T k-$ID-1 | cut -c1-200)"
echo "   $(date -u +%T) fresh key k-$ID-2 -> $(node client.mjs $DB taskcancelk $P $T k-$ID-2 | cut -c1-200)"
for k in $(seq 150); do sleep 2; [[ "$(tstate $P $T)" =~ ^cancelled ]] && break; done
echo "   $(date -u +%T) task $(tstate $P $T); child turn $(lastturn $C)"; ops $P
echo "   $(date -u +%T) first op now -> $(node client.mjs $DB op $P $OP | cut -c1-260)"
release ${ID}h
