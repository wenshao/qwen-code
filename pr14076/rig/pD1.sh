#!/bin/bash
# D1 (Stage F: lost cancel reply): the Harness commits the stop request but its answer to Spring is dropped
#    COUNT times. The operation must complete from the record without a duplicate stop.  usage: pD1.sh <db> <id> [count] [kind]
DB=$1; ID=$2; COUNT=${3:-1}; KIND=${4:-workflow}; source ./lib.sh
if [ "$KIND" = workflow ]; then P=$(newp "PARENT::wfbg::$ID::hold Run the workflow."); HK=${ID}h; else P=$(newp "PARENT::bg::$ID::hold Launch."); HK=$ID; fi
echo "== D1 [$DB] $KIND drop=$COUNT parent $P"
for i in $(seq 120); do grep -q "child-holding\",\"child\":\"CHILD::hold::${HK}\"" runs/model-requests.jsonl 2>/dev/null && break; sleep 1; done
sleep 3; T=$(ktask $P $([ $KIND = workflow ] && echo workflow || echo child_agent)); C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$P'")
echo "   task $T: $(tstate $P $T)"
echo "   arm proxy: $(arm_h "mode=drop&body=%22kind%22%3A%22cancel%22&count=$COUNT" | cut -c1-120)"
echo "   $(date -u +%T) cancel -> $(node client.mjs $DB taskcancelk $P $T k-$ID-1 | cut -c1-150)"
for i in $(seq 120); do s=$(sq "SELECT state FROM managed_agent_operation WHERE session_id='$P'"); [[ "$s" =~ ^(COMPLETED|FAILED|RECOVERY_BLOCKED) ]] && break; sleep 1; done
echo "   $(date -u +%T) op -> $s after ${i}s"
for i in $(seq 60); do s=$(tstate $P $T); [[ "$s" =~ ^(cancelled|completed|failed) ]] && break; sleep 1; done
echo "   $(date -u +%T) task -> $s; child turn -> $(lastturn $C)"
sleep 2; ops $P; ledger $P
echo "   cancel deliveries seen at the proxy:"; grep "$P" runs/$DB/fproxy.jsonl | grep -E '\\"kind\\":\\"cancel' | python3 -c "
import sys,json
for l in sys.stdin:
    o=json.loads(l); print('     ', o['t'][11:23], o.get('fault','pass'), 'upstream=' + str(o.get('upstreamStatus', o.get('status'))), (o.get('upstreamBody') or o.get('answer') or '')[:160])"
grep -c "$P" runs/$DB/spring.log | sed 's/^/   spring log lines for parent: /'; grep "$P" runs/$DB/spring.log | grep -i "cancel" | cut -c1-260 | tail -4
release $HK
