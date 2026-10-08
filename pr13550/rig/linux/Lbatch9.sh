#!/bin/bash
DB=L9; . /rig/llib.sh
running() { sq "SELECT COUNT(*) FROM managed_agent_turn t JOIN managed_agent_session s USING(tenant_id,session_id) WHERE s.parent_session_id='$1' AND t.status='RUNNING'"; }
echo "== $(date -u +%T) ra1: a finished background child, then close its parent"
P=$(newp "PARENT::bg::ra1::reply background child, then close."); echo $P > runs/ra1.sid; waitT $P 60 | tail -1; sleep 12; kids $P
node lclient.mjs $DB close $P | cut -c1-120; untilst "ra1 parent" "st $P" 90 CLOSED; ops $P
echo "== $(date -u +%T) re1: close the parent while its background child runs"
P=$(newp "PARENT::bg::re1::hold background child held open, then close the parent."); echo $P > runs/re1.sid; waitT $P 60 | tail -1
untilst "re1 child turn" "running $P" 60 1; echo "   workers=$(W)"
echo "   $(date -u +%T) close parent:"; node lclient.mjs $DB close $P | cut -c1-120
untilst "re1 parent" "st $P" 120 CLOSED; sleep 2; echo "   kids=$(kids $P | tr '\t\n' ': ') workers=$(W)"; turns $P; ops $P; ledger $P
grep -E "children/operations" /work/$DB/harness.log | tail -3 | cut -c1-200
curl -s http://127.0.0.1:18551/release/re1 >/dev/null
echo "== $(date -u +%T) rf1: delete the ACTIVE parent while its background child runs"
P=$(newp "PARENT::bg::rf1::hold background child held open, then delete the parent."); echo $P > runs/rf1.sid; waitT $P 60 | tail -1
untilst "rf1 child turn" "running $P" 60 1
echo "   $(date -u +%T) delete parent:"; node lclient.mjs $DB delete $P | cut -c1-200
echo "   $(date -u +%T) close, then delete:"; node lclient.mjs $DB close $P | cut -c1-100; untilst "rf1 parent" "st $P" 120 CLOSED
node lclient.mjs $DB delete $P | cut -c1-100; untilst "rf1 parent" "st $P" 60 DELETED; sleep 2; echo "   kids=$(kids $P | tr '\t\n' ': ') workers=$(W)"; ops $P
curl -s http://127.0.0.1:18551/release/rf1 >/dev/null
echo "== $(date -u +%T) batch9 DONE workers=$(W)"
for i in $(seq 100); do a=$(st $(cat runs/re1.sid)); b=$(st $(cat runs/rf1.sid)); [ "$a" = CLOSED ] && [ "$b" = CLOSED ] && break; sleep 3; done
for L in re1 rf1; do P=$(cat runs/$L.sid); echo "== $L parent=$(st $P) kids=$(kids $P | tr "\t\n" ": ")"; turns $P; ops $P; ledger $P; done
P=$(cat runs/rf1.sid); node lclient.mjs $DB delete $P | cut -c1-100; untilst "rf1 parent" "st $P" 60 DELETED
echo "== $(date -u +%T) batch9 final DONE"
