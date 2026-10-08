#!/bin/bash
DB=r6m; . /Users/wenshao/git/pr13550-rig/r3lib.sh
run() { L=$1; W=$2; shift 2; ./sc.sh $DB $L $W "$@"; }
t() { grep -o 'saw=[^"]*\|TERMINAL.*\|TIMEOUT' | cut -c1-150; }
echo "-- basics"
run a1 120 "PARENT::fg::r6a1::reply foreground child, plain answer." | t; sleep 3; ledger $(cat runs/$DB/a1.sid)
run a2 300 "PARENT::fg::r6a2::shell foreground child that runs a shell tool." | t
run a3 120 "PARENT::bg::r6a3::reply background child, plain answer." | tail -1; S=$(cat runs/$DB/a3.sid); consumed_wait $S 60; sleep 3; ledger $S
run a4 120 "PARENT::pre::r6a4::shell shell first, then a foreground child." | t
run a5 120 "PARENT::mixed::r6a5::shell shell and a foreground child in one batch." | t
run a6 120 "PARENT::prebg::r6a6::shell shell first, then a background child." | tail -1; consumed_wait $(cat runs/$DB/a6.sid) 120
echo "-- notification bound"
for x in "b1:fill20480c60:20 KiB of less-than" "b2:fill16290c60:16290 less-than" "b3:lines:multi-line answer"; do IFS=: read L SPEC DESC <<< "$x"
  run $L 120 "PARENT::bg::r6$L::$SPEC background child, $DESC." | tail -1; S=$(cat runs/$DB/$L.sid); consumed_wait $S 90; notif $S; done
S=$(cat runs/$DB/b2.sid); node client.mjs $DB send $S "PARENT::plain::r6b2f::x follow-up." >/dev/null; sleep 8; sq "SELECT status, IFNULL(error_code,'-') FROM managed_agent_turn WHERE session_id='$S' ORDER BY created_at DESC LIMIT 1"
run c3 120 "PARENT::bigp::r6c3::reply foreground child with a 40 KiB prompt." | t
echo "-- C1: fg child with a 100 KiB answer"
run k1 120 "PARENT::fg::r6k1::mid foreground child, 100 KiB answer." | t; sleep 3; ledger $(cat runs/$DB/k1.sid)
echo "-- C1: four failing bg children, then a fresh launch"
run e1 120 "PARENT::five::r6e1::error five background children that fail." | t
S=$(cat runs/$DB/e1.sid); sleep 25; ledger $S
node client.mjs $DB send $S "PARENT::bg::r6e1b::reply one more background child after the failures." | cut -c1-60; sleep 15; modelsaw r6e1b 140; ledger $S
echo "-- ledger rows on this stack by state"
sq "SELECT state, COUNT(*), MAX(attempts) FROM qwen_managed_child_result_relay GROUP BY state"
echo "== $(date -u +%T) r6mac DONE"
