#!/bin/bash
DB=L10; . /rig/llib.sh
running() { sq "SELECT COUNT(*) FROM managed_agent_turn t JOIN managed_agent_session s USING(tenant_id,session_id) WHERE s.parent_session_id='$1' AND t.status='RUNNING'"; }
child() { for i in $(seq 30); do C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$1' LIMIT 1"); [ -n "$C" ] && { echo $C; return; }; sleep 1; done; }
echo "== $(date -u +%T) basics"
for x in "fg sb1 reply" "bg sb2 reply" "fg sb3 mid" "fg sb4 error" "bg sb5 error"; do set -- $x
  P=$(newp "PARENT::$1::$2::$3 $1 child on linux."); echo $P > runs/$2.sid; T0=$(date +%s)
  echo "-- $2 ($1/$3)"; waitT $P 240; echo "   parent turn done after $(( $(date +%s)-T0 ))s"
  C=$(child $P); untilst "$2 child" "st $C" 120 CLOSED; sleep 3; ledger $P
done
echo "== $(date -u +%T) four failing bg children, then a fresh launch"
P=$(newp "PARENT::five::sb6::error five failing background children."); echo $P > runs/sb6.sid; waitT $P 60 | tail -1; sleep 30; ledger $P
node lclient.mjs $DB send $P "PARENT::bg::sb6b::reply one more background child after the failures." | cut -c1-60; sleep 15; grep "::sb6b" runs/model-requests.jsonl | cut -c1-200
echo "== $(date -u +%T) parent close/delete"
P=$(newp "PARENT::bg::sa2::reply background child, then close."); echo $P > runs/sa2.sid; waitT $P 60 | tail -1; sleep 12; kids $P
node lclient.mjs $DB close $P | cut -c1-100; untilst "sa2 parent" "st $P" 60 CLOSED; ops $P
node lclient.mjs $DB delete $P | cut -c1-100; untilst "sa2 parent" "st $P" 60 DELETED
P=$(newp "PARENT::bg::se1::hold background child held open, then close the parent."); echo $P > runs/se1.sid; waitT $P 60 | tail -1
untilst "se1 child turn" "running $P" 60 1; echo "   $(date -u +%T) close"; node lclient.mjs $DB close $P | cut -c1-100
sleep 40; echo "   $(date -u +%T) +40s parent=$(st $P) kids=$(kids $P | tr '\t\n' ': ')"; ops $P
echo "   $(date -u +%T) release"; curl -s http://127.0.0.1:18551/release/se1 >/dev/null; untilst "se1 parent" "st $P" 200 CLOSED; turns $P; ops $P; ledger $P
grep "children/operations" /work/$DB/harness.log | grep "$P" | grep -o "status=[0-9]*" | sort | uniq -c | tr '\n' ' '; echo
P=$(newp "PARENT::bg::sf1::hold background child held open, then delete the parent."); echo $P > runs/sf1.sid; waitT $P 60 | tail -1; untilst "sf1 child turn" "running $P" 60 1
echo "   delete ACTIVE:"; node lclient.mjs $DB delete $P | cut -c1-140
curl -s http://127.0.0.1:18551/release/sf1 >/dev/null; sleep 5; node lclient.mjs $DB close $P | cut -c1-100; untilst "sf1 parent" "st $P" 200 CLOSED
node lclient.mjs $DB delete $P | cut -c1-100; untilst "sf1 parent" "st $P" 60 DELETED; ops $P
echo "== $(date -u +%T) Files-profile control: L3 protocol-1 close still works"
sq "UPDATE rig_profile SET mode='files'"
P=$(newp "PARENT::plain::fp1::x files-profile session."); echo $P > runs/fp1.sid; waitT $P 60 | tail -1
sq "SELECT tool_profile FROM managed_agent_session WHERE session_id='$P'"
node lclient.mjs $DB close $P | cut -c1-100; untilst "fp1" "st $P" 90 CLOSED; ops $P
node lclient.mjs $DB delete $P | cut -c1-100; untilst "fp1" "st $P" 60 DELETED; ops $P
P=$(newp "PARENT::plain::fp2::x files-profile session, ACTIVE delete."); echo $P > runs/fp2.sid; waitT $P 60 | tail -1
node lclient.mjs $DB delete $P | cut -c1-100; untilst "fp2" "st $P" 90 DELETED; ops $P
sq "UPDATE rig_profile SET mode='shell'"
echo "== $(date -u +%T) batch10 DONE workers=$(W)"
