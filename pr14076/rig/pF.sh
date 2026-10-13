#!/bin/bash
# F: after a cancel settles, does the workflow script keep executing? Release every held subagent after the
#    cancel, wait, and count model requests from the script's NEXT agent() call (CHILD::reply::<id>z).
#    usage: pF.sh <db> <id> <spec holdafter|parhold> <mode wfbg|wffg> <cancel yes|no>
DB=$1; ID=$2; SPEC=$3; MODE=$4; DO=$5; source ./lib.sh
P=$(newp "PARENT::$MODE::$ID::$SPEC Run the workflow."); echo "== F [$DB] $MODE/$SPEC cancel=$DO parent $P"
need=$([ $SPEC = parhold ] && echo 2 || echo 1)
for i in $(seq 120); do n=$(grep -c -E "child-holding\",\"child\":\"CHILD::hold::${ID}(h|k)\"" runs/model-requests.jsonl); [ "$n" -ge $need ] && break; sleep 1; done
sleep 3; T=$(ktask $P workflow); C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$P'")
echo "   task $(tstate $P $T)"
if [ $DO = yes ]; then
  echo "   $(date -u +%T) cancel -> $(node client.mjs $DB taskcancelk $P $T k-$ID-1 | cut -c1-120)"
  for i in $(seq 90); do [[ "$(tstate $P $T)" =~ ^(cancelled|completed|failed) ]] && break; sleep 1; done
  echo "   $(date -u +%T) task $(tstate $P $T); child turn $(lastturn $C)"
fi
release ${ID}h; [ $SPEC = parhold ] && release ${ID}k
sleep 15
z=$(grep -c "\"child\":\"CHILD::reply::${ID}z\"" runs/model-requests.jsonl)
echo "   $(date -u +%T) +15s: model requests from the script's next agent() call: $z"
for i in $(seq 60); do [[ "$(tstate $P $T)" =~ ^(cancelled|completed|failed) ]] && break; sleep 1; done
echo "   final: task $(tstate $P $T); child turn $(lastturn $C); parent turn(s) $(sq "SELECT GROUP_CONCAT(status ORDER BY created_at) FROM managed_agent_turn WHERE session_id='$P'")"
