#!/bin/bash
# E1: a workflow that completed on its own -> no action, cancel refused.
# E2: a running workflow whose parent Session is being closed -> no action, cancel refused.  usage: pE.sh <db> <id>
DB=$1; ID=$2; source ./lib.sh
P=$(newp "PARENT::wfbg::${ID}x::pure Run the workflow."); echo "== E1 [$DB] parent $P"
for i in $(seq 60); do T=$(ktask $P workflow); [ -n "$T" ] && [[ "$(tstate $P $T)" =~ ^completed ]] && break; sleep 1; done
echo "   task $(tstate $P $T)"; echo "   cancel -> $(node client.mjs $DB taskcancelk $P $T k-${ID}x | cut -c1-170)"
echo "   webshell cancel -> $(node client.mjs $DB wscancel $P $T k-${ID}y | cut -c1-170)"
P=$(newp "PARENT::wfbg::${ID}c::hold Run the workflow."); echo "== E2 [$DB] parent $P"
for i in $(seq 120); do grep -q "child-holding\",\"child\":\"CHILD::hold::${ID}ch\"" runs/model-requests.jsonl && break; sleep 1; done
sleep 3; T=$(ktask $P workflow); C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$P'"); echo "   task $(tstate $P $T)"
echo "   $(date -u +%T) close parent -> $(node client.mjs $DB close $P | cut -c1-150)"; sleep 1
echo "   $(date -u +%T) parent=$(sst $P) task $(tstate $P $T)"
echo "   $(date -u +%T) cancel -> $(node client.mjs $DB taskcancelk $P $T k-${ID}c | cut -c1-200)"
for i in $(seq 90); do [[ "$(sst $P)" =~ ^(CLOSED|ARCHIVED) ]] && [[ "$(lastturn $C)" =~ ^(COMPLETED|FAILED|CANCELLED) ]] && break; sleep 1; done
echo "   $(date -u +%T) after ${i}s: parent=$(sst $P) child turn=$(lastturn $C) task $(tstate $P $T)"
echo "   cancel after close -> $(node client.mjs $DB taskcancelk $P $T k-${ID}d | cut -c1-200)"
release ${ID}ch
