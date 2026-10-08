#!/bin/bash
DB=L12; . /rig/llib.sh
running() { sq "SELECT COUNT(*) FROM managed_agent_turn t JOIN managed_agent_session s USING(tenant_id,session_id) WHERE s.parent_session_id='$1' AND t.status='RUNNING'"; }
P=$(newp "PARENT::bg::ue1::hold background child held open, then close the parent."); echo $P > runs/ue1.sid; waitT $P 60 | tail -1
untilst "ue1 child turn" "running $P" 60 1; echo "   $(date -u +%T) close"; node lclient.mjs $DB close $P | cut -c1-100
sleep 40; echo "   $(date -u +%T) +40s parent=$(st $P) kids=$(kids $P | tr '\t\n' ': ')"; ops $P; ledger $P
echo "   $(date -u +%T) release"; curl -s http://127.0.0.1:18551/release/ue1 >/dev/null; untilst "ue1 parent" "st $P" 200 CLOSED; turns $P; ops $P; ledger $P
grep "children/operations" /work/$DB/harness.log | grep "$P" | grep -o "status=[0-9]*" | sort | uniq -c | tr '\n' ' '; echo
P=$(newp "PARENT::bg::uf1::hold background child held open, then delete the parent."); echo $P > runs/uf1.sid; waitT $P 60 | tail -1; untilst "uf1 child turn" "running $P" 60 1
echo "   delete ACTIVE:"; node lclient.mjs $DB delete $P | cut -c1-140; echo "   close:"; node lclient.mjs $DB close $P | cut -c1-100
sleep 20; curl -s http://127.0.0.1:18551/release/uf1 >/dev/null; untilst "uf1 parent" "st $P" 200 CLOSED
node lclient.mjs $DB delete $P | cut -c1-100; untilst "uf1 parent" "st $P" 60 DELETED; ops $P; ledger $P
echo "-- ledger states"; sq "SELECT state, COUNT(*) FROM qwen_managed_child_result_relay GROUP BY state"; echo "-- child session states"; sq "SELECT status, COUNT(*) FROM managed_agent_session WHERE parent_session_id IS NOT NULL GROUP BY status"
echo "== $(date -u +%T) batch12b DONE"
