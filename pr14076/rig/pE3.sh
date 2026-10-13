#!/bin/bash
# E3: the "in an active Session" gate for a workflow task: force the parent row to CLOSING by SQL, read the view and
#     try a cancel; restore ACTIVE and cancel again.  usage: pE3.sh <db> <id>
DB=$1; ID=$2; source ./lib.sh
P=$(newp "PARENT::wfbg::$ID::hold Run the workflow."); echo "== E3 [$DB] parent $P"
for i in $(seq 120); do grep -q "child-holding\",\"child\":\"CHILD::hold::${ID}h\"" runs/model-requests.jsonl && break; sleep 1; done
sleep 3; T=$(ktask $P workflow); echo "   ACTIVE : task $(tstate $P $T)"
sq "UPDATE managed_agent_session SET status='CLOSING' WHERE session_id='$P'"
echo "   CLOSING (forced by SQL): task $(tstate $P $T)"
echo "   CLOSING cancel -> $(node client.mjs $DB taskcancelk $P $T k-$ID-1 | cut -c1-170)"
sq "UPDATE managed_agent_session SET status='ACTIVE' WHERE session_id='$P'"
echo "   ACTIVE again cancel -> $(node client.mjs $DB taskcancelk $P $T k-$ID-2 | cut -c1-120)"
for i in $(seq 40); do [[ "$(tstate $P $T)" =~ ^cancelled ]] && break; sleep 1; done; echo "   task $(tstate $P $T)"
release ${ID}h
