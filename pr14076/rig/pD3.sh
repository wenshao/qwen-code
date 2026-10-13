#!/bin/bash
# D3 (Stage F: cancel after the owner is gone): SIGKILL the Harness while the child is held, POST the cancel,
#    keep the Harness down DOWN seconds, then restart it and follow the operation to its end.  usage: pD3.sh <db> <id> <downSec> [kind]
DB=$1; ID=$2; DOWN=$3; KIND=${4:-workflow}; source ./lib.sh
if [ "$KIND" = workflow ]; then P=$(newp "PARENT::wfbg::$ID::hold Run the workflow."); HK=${ID}h; TK=workflow; else P=$(newp "PARENT::bg::$ID::hold Launch."); HK=$ID; TK=child_agent; fi
echo "== D3 [$DB] $KIND down=${DOWN}s parent $P"
for i in $(seq 120); do grep -q "child-holding\",\"child\":\"CHILD::hold::${HK}\"" runs/model-requests.jsonl 2>/dev/null && break; sleep 1; done
sleep 3; T=$(ktask $P $TK); C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$P'")
echo "   task $T: $(tstate $P $T); child turn $(lastturn $C)"
echo "   $(date -u +%T) kill harness: $(node stack.mjs stop $DB harness | tail -1)"
sleep 2
echo "   $(date -u +%T) cancel -> $(node client.mjs $DB taskcancelk $P $T k-$ID-1 | cut -c1-160)"
snap() { echo "   $(date -u +%T) op=$(sq "SELECT CONCAT(state,'/',IFNULL(error_code,'-'),' attempts=',attempt_count,' claim=',claim_generation) FROM managed_agent_operation WHERE session_id='$P'") task=$(tstate $P $T) child=$(lastturn $C) parent=$(sst $P)"; }
for k in $(seq $((DOWN/10))); do sleep 10; snap; done
echo "   $(date -u +%T) restart harness: $(node stack.mjs harness $DB | tail -1)"
for k in $(seq 24); do sleep 5; snap; s=$(sq "SELECT state FROM managed_agent_operation WHERE session_id='$P'"); t=$(tstate $P $T); [[ "$s" =~ ^(COMPLETED|FAILED) && "$t" =~ ^(cancelled|completed|failed|recovery_blocked) ]] && break; done
turns $P; ledger $P; ops $P
echo "   cancel deliveries at the proxy:"; grep "$P" runs/$DB/fproxy.jsonl | grep -E 'kind\\":\\"cancel|upstreamError' | python3 -c "
import sys,json
for l in sys.stdin:
    o=json.loads(l); print('     ', o['t'][11:23], o.get('fault','pass'), 'status=' + str(o.get('status', o.get('upstreamError','')))[:60], (o.get('answer') or '')[:140])"
grep -E "Task cancel|task cancel" runs/$DB/spring.log | grep -F "$P" | cut -c1-330 | tail -6
release $HK
