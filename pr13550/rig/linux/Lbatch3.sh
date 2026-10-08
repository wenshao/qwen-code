#!/bin/bash
DB=L3; . /rig/llib.sh
running() { sq "SELECT COUNT(*) FROM managed_agent_turn t JOIN managed_agent_session s USING(tenant_id,session_id) WHERE s.parent_session_id='$1' AND t.status='RUNNING'"; }
P=$(newp "PARENT::bg::lj1::hold background child the user will stop directly."); echo $P > runs/lj1.sid
echo "== $(date -u +%T) lj1 parent=$P"; waitT $P 60 | tail -1; untilst "lj1 child turn" "running $P" 60 1
C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$P'"); T=$(sq "SELECT turn_id FROM managed_agent_turn WHERE session_id='$C'")
echo "   $(date -u +%T) user cancels the child's Turn directly:"; node lclient.mjs $DB cancel $C $T | cut -c1-200
for i in $(seq 20); do s=$(sq "SELECT status FROM managed_agent_turn WHERE session_id='$C'"); [ "$s" != RUNNING ] && break; sleep 0.25; done; echo "   child turn=$s"
echo "   $(date -u +%T) user closes the child directly:"; node lclient.mjs $DB close $C | cut -c1-200
sleep 40; echo "   $(date -u +%T) +40s child=$(st $C) parent=$(st $P)"; turns $P; ops $P; ledger $P
grep "lj1\|$C" /work/$DB/spring.log | grep -i "falter\|retry\|conflict" | tail -3 | cut -c100-420
echo "-- a fresh launch on the same parent"; node lclient.mjs $DB send $P "PARENT::bg::lj2::reply another background child." | cut -c1-60; sleep 12; ledger $P
echo "== $(date -u +%T) batch3 DONE"
