#!/bin/bash
DB=L5; . /rig/llib.sh
running() { sq "SELECT COUNT(*) FROM managed_agent_turn t JOIN managed_agent_session s USING(tenant_id,session_id) WHERE s.parent_session_id='$1' AND t.status='RUNNING'"; }
drain() { sq "SELECT phase FROM qwen_runtime_harness_drain WHERE harness_session_id='$1'"; }
echo "== $(date -u +%T) na2: a finished background child, then close its parent"
P=$(newp "PARENT::bg::na2::reply background child, then close."); echo $P > runs/na2.sid; waitT $P 60 | tail -1; sleep 12; kids $P
node lclient.mjs $DB close $P | cut -c1-100; untilst "na2 parent" "st $P" 60 CLOSED; ops $P; echo "   drain=$(drain $P)"
for x in "close ne1" "delete nf1"; do set -- $x
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
echo "== $(date -u +%T) batch5 DONE"
