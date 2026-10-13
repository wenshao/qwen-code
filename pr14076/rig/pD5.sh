#!/bin/bash
# D5 (owner gone past the whole delivery budget; stack with retry-max-delay=2s): the cancel parks recovery_blocked
#    while the Harness is down. Follow the parked op and the task after the restart, then try a fresh key.
#    usage: pD5.sh <db> <id> <downSec>
DB=$1; ID=$2; DOWN=$3; source ./lib.sh
P=$(newp "PARENT::wfbg::$ID::hold Run the workflow."); echo "== D5 [$DB] down=${DOWN}s parent $P"
for i in $(seq 120); do grep -q "child-holding\",\"child\":\"CHILD::hold::${ID}h\"" runs/model-requests.jsonl && break; sleep 1; done
sleep 3; T=$(ktask $P workflow); C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$P'")
echo "   $(date -u +%T) kill harness: $(node stack.mjs stop $DB harness | tail -1)"; sleep 2
R=$(node client.mjs $DB taskcancelk $P $T k-$ID-1); OP=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['json']['id'])"); echo "   $(date -u +%T) cancel -> $OP"
opst() { sq "SELECT CONCAT(state,'/',IFNULL(error_code,'-'),' attempts=',attempt_count,' claim=',claim_generation,' delivery=',IFNULL(delivery_state,'-')) FROM managed_agent_operation WHERE operation_id='$1'"; }
for k in $(seq $((DOWN/10))); do sleep 10; echo "   $(date -u +%T) op=$(opst $OP) task=$(tstate $P $T) child=$(lastturn $C)"; done
echo "   $(date -u +%T) GET op -> $(node client.mjs $DB op $P $OP | cut -c1-300)"
echo "   $(date -u +%T) while parked + Harness down, fresh key -> $(node client.mjs $DB taskcancelk $P $T k-$ID-0 | cut -c1-160)"
echo "   $(date -u +%T) restart harness: $(node stack.mjs harness $DB | tail -1)"
for k in $(seq 12); do sleep 10; echo "   $(date -u +%T) op1=$(opst $OP) task=$(tstate $P $T) child=$(lastturn $C)"; done
O2=$(sq "SELECT operation_id FROM managed_agent_operation WHERE session_id='$P' AND idempotency_key='k-$ID-0'")
[ -n "$O2" ] && echo "   op(k-$ID-0)=$(opst $O2)"
echo "   $(date -u +%T) fresh key k-$ID-2 -> $(node client.mjs $DB taskcancelk $P $T k-$ID-2 | cut -c1-200)"
for k in $(seq 60); do sleep 2; [[ "$(tstate $P $T)" =~ ^(cancelled|completed|failed) ]] && break; done
echo "   $(date -u +%T) task $(tstate $P $T); child turn $(lastturn $C)"; ops $P; ledger $P
release ${ID}h
