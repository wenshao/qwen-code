#!/bin/bash
DB=L8; . /rig/llib.sh
running() { sq "SELECT COUNT(*) FROM managed_agent_turn t JOIN managed_agent_session s USING(tenant_id,session_id) WHERE s.parent_session_id='$1' AND t.status='RUNNING'"; }
drain() { sq "SELECT phase FROM qwen_runtime_harness_drain WHERE harness_session_id='$1'"; }
echo "== $(date -u +%T) qa2: a finished background child, then close its parent"
P=$(newp "PARENT::bg::qa2::reply background child, then close."); echo $P > runs/qa2.sid; waitT $P 60 | tail -1; sleep 12; kids $P
node lclient.mjs $DB close $P | cut -c1-100; untilst "qa2 parent" "st $P" 60 CLOSED; ops $P; echo "   drain=$(drain $P)"
for x in "close qe1" "delete qf1"; do set -- $x
  P=$(newp "PARENT::bg::$2::hold background child held open, then $1 the parent."); echo $P > runs/$2.sid
  echo "== $(date -u +%T) $2: $1 the parent while its child runs"; waitT $P 60 | tail -1; untilst "$2 child turn" "running $P" 60 1
  node lclient.mjs $DB $1 $P | cut -c1-100
  sleep 40; echo "   $(date -u +%T) +40s parent=$(st $P) kids=$(kids $P | tr '\t\n' ': ') drain=$(drain $P)"; turns $P; ops $P; ledger $P
  grep "children/operations" /work/$DB/harness.log | grep "$P" | grep -o "status=[0-9]*" | sort | uniq -c | tr '\n' ' '; echo
  echo "   $(date -u +%T) release the held child"; curl -s http://127.0.0.1:18551/release/$2 >/dev/null
  untilst "$2 parent" "st $P" 150 $( [ $1 = close ] && echo CLOSED || echo DELETED )
  echo "   kids=$(kids $P | tr '\t\n' ': ') drain=$(drain $P)"; turns $P; ops $P
  grep "children/operations" /work/$DB/harness.log | grep "$P" | grep -o "status=[0-9]*" | sort | uniq -c | tr '\n' ' '; echo
  grep "$P" /work/$DB/spring.log | grep -i "falter\|cannot\|blocked\|will retry" | tail -3 | cut -c100-400
done
echo "== $(date -u +%T) batch8 DONE"
echo "== $(date -u +%T) basics on this head"
for x in "fg qb1 reply" "bg qb2 reply" "fg qb3 mid" "fg qb4 error"; do set -- $x
  P=$(newp "PARENT::$1::$2::$3 $1 child on linux."); echo $P > runs/$2.sid; T0=$(date +%s)
  echo "-- $2 ($1/$3)"; waitT $P 240; echo "   parent turn done after $(( $(date +%s)-T0 ))s"
  for i in $(seq 30); do C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$P'"); [ -n "$C" ] && break; sleep 1; done
  untilst "$2 child" "st $C" 120 CLOSED; sleep 2; ledger $P
done
echo "== $(date -u +%T) batch8 basics DONE"
