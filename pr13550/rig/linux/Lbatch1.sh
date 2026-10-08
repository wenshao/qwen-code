#!/bin/bash
DB=L3; . /rig/llib.sh
echo "== $(date -u +%T) workers before: $(W)"
for x in "fg la1 reply" "bg la2 reply" "fg lb1 mid" "fg lc1 error" "bg lc2 error"; do set -- $x
  P=$(newp "PARENT::$1::$2::$3 $1 child on linux."); echo $P > runs/$2.sid; T0=$(date +%s)
  echo "== $(date -u +%T) $2 ($1/$3) parent=$P"; waitT $P 240; echo "   parent turn done after $(( $(date +%s)-T0 ))s"
  C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$P'")
  untilst "$2 child" "st $C" 120 CLOSED; sleep 3; ledger $P; ops $P; echo "   workers=$(W)"
done
echo "== $(date -u +%T) LD: close la2's parent after its child finished"
P=$(cat runs/la2.sid); node lclient.mjs $DB close $P | cut -c1-200; untilst "la2 parent" "st $P" 90 CLOSED; ops $P
echo "== $(date -u +%T) batch1 DONE workers=$(W)"
