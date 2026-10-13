#!/bin/bash
# B: cancel a FOREGROUND workflow task while the parent Turn waits on it.  usage: pB.sh <db> <id>
DB=$1; ID=$2; source ./lib.sh
P=$(newp "PARENT::wffg::$ID::hold Run the workflow."); echo "== B [$DB] parent $P"
for i in $(seq 120); do grep -q "child-holding\",\"child\":\"CHILD::hold::${ID}h" runs/model-requests.jsonl 2>/dev/null && break; sleep 1; done
C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$P'"); sleep 2
T=$(ktask $P); echo "   child $C held; task $T: $(tstate $P $T); parent turn: $(lastturn $P)"
R=$(node client.mjs $DB taskcancelk $P $T k-$ID-1); echo "   $(date -u +%T) POST cancel -> $(echo $R | cut -c1-200)"
s=$(waitterm $P 60); echo "   $(date -u +%T) parent turn -> $s; child turn -> $(lastturn $C); task -> $(tstate $P $T)"
turns $P; ledger $P; ops $P
echo "   what the parent model saw:"; modelsaw "PARENT::wffg::$ID::" 500 | grep -E "parent-after" | tail -1
release ${ID}h
