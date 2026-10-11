#!/bin/bash
# Round 2: kill the Harness after the fg workflow child COMPLETED but before the relay
# delivered its result (needs a stack started with RIG_SCAN_DELAY, e.g. 20s).
# usage: pdone.sh <db> <id> [spec]
DB=$1; ID=$2; SPEC=${3:-pure}; source ./lib.sh
P=$(newp "PARENT::wffg::$ID::$SPEC Run it."); echo "parent $P (wffg/$SPEC)"
for i in $(seq 240); do
  c=$(sq "SELECT COUNT(*) FROM managed_agent_turn t JOIN managed_agent_session s USING(tenant_id,session_id) WHERE s.parent_session_id='$P' AND t.status='COMPLETED'")
  [ "$c" -ge 1 ] && break; sleep 0.25; done
echo "   at kill: child turn COMPLETED=$c  child_run=$(sq "SELECT CONCAT(revision,' ',IFNULL(task_state,'-'),' ',IFNULL(delivery_state,'-')) FROM qwen_managed_session_extension_record WHERE session_id='$P' AND domain='child_run'")  relay=$(sq "SELECT CONCAT(state,' a=',attempts) FROM qwen_managed_child_result_relay WHERE parent_session_id='$P'")"
restart 2
echo "   final: $(waitterm $P 150)"
turns $P; ledger $P; ckpts $P 4
python3 toolres.py $DB $P | cut -c1-260
