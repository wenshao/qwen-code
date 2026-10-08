#!/bin/bash
DB=r3m; . /Users/wenshao/git/pr13550-rig/r3lib.sh
run() { L=$1; W=$2; shift 2; ./sc.sh $DB $L $W "$@"; }
run a1 120 "PARENT::fg::a1::reply foreground child, plain answer."; sleep 3; ledger $(cat runs/$DB/a1.sid)
run a2 300 "PARENT::fg::a2::shell foreground child that runs a shell tool."; sleep 3; ledger $(cat runs/$DB/a2.sid)
run a3 120 "PARENT::bg::a3::reply background child, plain answer."; S=$(cat runs/$DB/a3.sid); consumed_wait $S 60; sleep 3; ledger $S; notif $S; modelsaw a3 400
node client.mjs $DB tasks $S | grep -o '"id": *"task_[^"]*"\|"status": *"[^"]*"' | head -4 | tr '\n' ' '; echo
run a4 120 "PARENT::pre::a4::shell shell first, then a foreground child."; sleep 3; ledger $(cat runs/$DB/a4.sid); modelsaw a4 400
run a5 120 "PARENT::mixed::a5::shell shell and a foreground child in one batch."; sleep 3; ledger $(cat runs/$DB/a5.sid); modelsaw a5 400
run a6 120 "PARENT::prebg::a6::shell shell first, then a background child."; S=$(cat runs/$DB/a6.sid); consumed_wait $S 120; sleep 3; ledger $S; modelsaw a6 300
echo "== $(date -u +%T) batch1 DONE"
