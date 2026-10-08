#!/bin/bash
DB=L3; . /rig/llib.sh
running() { sq "SELECT COUNT(*) FROM managed_agent_turn t JOIN managed_agent_session s USING(tenant_id,session_id) WHERE s.parent_session_id='$1' AND t.status='RUNNING'"; }
for x in "close le1" "delete lf1"; do set -- $x
  P=$(newp "PARENT::bg::$2::hold background child held open, then $1 the parent."); echo $P > runs/$2.sid
  echo "== $(date -u +%T) $2: parent=$P"; waitT $P 60 | tail -1
  untilst "$2 child turn" "running $P" 60 1; echo "   workers=$(W)"
  echo "   $(date -u +%T) $1 parent:"; node lclient.mjs $DB $1 $P | cut -c1-220
  sleep 30; echo "   $(date -u +%T) +30s parent=$(st $P) kids=$(kids $P | tr '\t\n' ': ')"; turns $P; ops $P; ledger $P
  grep -E "lifecycle_active|lifecycle claim|children/operations|cascade" /work/$DB/spring.log /work/$DB/harness.log | tail -4 | cut -c1-300
  echo "   $(date -u +%T) release the held child model call"; curl -s http://127.0.0.1:18551/release/$2
  untilst "$2 parent" "st $P" 120 $( [ $1 = close ] && echo CLOSED || echo DELETED )
  sleep 3; echo "   kids=$(kids $P | tr '\t\n' ': ') workers=$(W)"; turns $P; ops $P; ledger $P
done
echo "== $(date -u +%T) LH: four failing background children, then a fresh launch (contrast with macOS)"
P=$(newp "PARENT::five::lh1::error five failing background children."); echo $P > runs/lh1.sid; waitT $P 60
sleep 30; ledger $P; node lclient.mjs $DB send $P "PARENT::bg::lh1b::reply one more background child after the failures." | cut -c1-60
sleep 15; grep '::lh1b' runs/model-requests.jsonl | cut -c1-230
echo "== $(date -u +%T) LI: can the public API reach a child Session?"
C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$(cat runs/la1.sid)'"); node lclient.mjs $DB get $C | cut -c1-200
echo "== $(date -u +%T) batch2 DONE workers=$(W)"
