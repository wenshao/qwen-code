#!/bin/bash
# A: cancel a RUNNING background workflow task (held subagent) through the public route, then
#    replay the key on both surfaces and re-cancel the settled task.  usage: pA.sh <db> <id>
DB=$1; ID=$2; source ./lib.sh
P=$(newp "PARENT::wfbg::$ID::hold Run the workflow."); echo "== A [$DB] parent $P"
for i in $(seq 120); do grep -q "child-holding\",\"child\":\"CHILD::hold::${ID}h" runs/model-requests.jsonl 2>/dev/null && break; sleep 1; done
C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$P'"); echo "   child session $C (held after ${i}s)"
echo "   tasks before:"; node client.mjs $DB tasksum $P | sed 's/^/     /'
T=$(ktask $P); echo "   workflow task $T"
K="k-$ID-1"
R=$(node client.mjs $DB taskcancelk $P $T $K); echo "   POST cancel key=$K -> $(echo $R | cut -c1-400)"
OP=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['json'].get('id','-'))" 2>/dev/null)
for i in $(seq 60); do s=$(node client.mjs $DB op $P $OP 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['json'].get('status','?'))" 2>/dev/null); [[ "$s" =~ ^(completed|failed|recovery_blocked|cancelled)$ ]] && break; sleep 1; done
echo "   GET operation after ${i}s -> $(node client.mjs $DB op $P $OP | cut -c1-500)"
for i in $(seq 60); do s=$(lastturn $C); [[ "$s" =~ ^(COMPLETED|FAILED|CANCELLED) ]] && break; sleep 1; done
echo "   child turn: $s (after ${i}s more)"
sleep 3
echo "   tasks after:"; node client.mjs $DB tasksum $P | sed 's/^/     /'
echo "   replay same key public -> $(node client.mjs $DB taskcancelk $P $T $K | cut -c1-300)"
echo "   replay same key webshell -> $(node client.mjs $DB wscancel $P $T $K | cut -c1-300)"
echo "   new key on settled task -> $(node client.mjs $DB taskcancelk $P $T k-$ID-2 | cut -c1-300)"
echo "   task events:"; node client.mjs $DB taskevents $P $T | cut -c1-300 | sed 's/^/     /'
for i in $(seq 40); do n=$(sq "SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='$P'"); [ "$n" -ge 2 ] && [[ "$(lastturn $P)" =~ ^(COMPLETED|FAILED|CANCELLED) ]] && break; sleep 1; done
turns $P; ledger $P; ops $P
echo "   parent wake text:"; modelsaw "PARENT::wfbg::$ID::" 400 | grep -E "parent-wake|parent-after" | tail -2
release ${ID}h
