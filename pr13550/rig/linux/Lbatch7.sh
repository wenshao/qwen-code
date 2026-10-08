#!/bin/bash
DB=L7; . /rig/llib.sh
running() { sq "SELECT COUNT(*) FROM managed_agent_turn t JOIN managed_agent_session s USING(tenant_id,session_id) WHERE s.parent_session_id='$1' AND t.status='RUNNING'"; }
echo "== $(date -u +%T) pa1: a finished background child, then close its parent"
P=$(newp "PARENT::bg::pa1::reply background child, then close."); echo $P > runs/pa1.sid; waitT $P 60 | tail -1; sleep 12; kids $P
node lclient.mjs $DB close $P | cut -c1-120; untilst "pa1 parent" "st $P" 90 CLOSED; ops $P
echo "== $(date -u +%T) pe1: close the parent while its background child runs"
P=$(newp "PARENT::bg::pe1::hold background child held open, then close the parent."); echo $P > runs/pe1.sid; waitT $P 60 | tail -1
untilst "pe1 child turn" "running $P" 60 1; echo "   workers=$(W)"
echo "   $(date -u +%T) close parent:"; node lclient.mjs $DB close $P | cut -c1-120
untilst "pe1 parent" "st $P" 120 CLOSED; sleep 2; echo "   kids=$(kids $P | tr '\t\n' ': ') workers=$(W)"; turns $P; ops $P; ledger $P
grep -E "children/operations" /work/$DB/harness.log | tail -3 | cut -c1-200
curl -s http://127.0.0.1:18551/release/pe1 >/dev/null
echo "== $(date -u +%T) pf1: delete the ACTIVE parent while its background child runs"
P=$(newp "PARENT::bg::pf1::hold background child held open, then delete the parent."); echo $P > runs/pf1.sid; waitT $P 60 | tail -1
untilst "pf1 child turn" "running $P" 60 1
echo "   $(date -u +%T) delete parent:"; node lclient.mjs $DB delete $P | cut -c1-200
echo "   $(date -u +%T) close, then delete:"; node lclient.mjs $DB close $P | cut -c1-100; untilst "pf1 parent" "st $P" 120 CLOSED
node lclient.mjs $DB delete $P | cut -c1-100; untilst "pf1 parent" "st $P" 60 DELETED; sleep 2; echo "   kids=$(kids $P | tr '\t\n' ': ') workers=$(W)"; ops $P
curl -s http://127.0.0.1:18551/release/pf1 >/dev/null
echo "== $(date -u +%T) batch7 DONE workers=$(W)"
