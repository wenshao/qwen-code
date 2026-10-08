#!/bin/bash
DB=r4m; . /Users/wenshao/git/pr13550-rig/r3lib.sh
run() { L=$1; W=$2; shift 2; ./sc.sh $DB $L $W "$@"; }
run a1 120 "PARENT::fg::r4a1::reply foreground child, plain answer." | grep -o 'saw=[^"]*\|TERMINAL.*' | cut -c1-120
run a2 300 "PARENT::fg::r4a2::shell foreground child that runs a shell tool." | grep -o 'saw=[^"]*\|TERMINAL.*' | cut -c1-120
run a3 120 "PARENT::bg::r4a3::reply background child, plain answer." | tail -1; S=$(cat runs/$DB/a3.sid); consumed_wait $S 60
run a4 120 "PARENT::pre::r4a4::shell shell first, then a foreground child." | grep -o 'saw=[^"]*' | cut -c1-140
run b1 120 "PARENT::bg::r4b1::fill20480c60 background child, 20 KiB of less-than." | tail -1; S=$(cat runs/$DB/b1.sid); consumed_wait $S 90; notif $S
run b3 120 "PARENT::bg::r4b3::lines background child, multi-line answer." | tail -1; S=$(cat runs/$DB/b3.sid); consumed_wait $S 90; notif $S
run c3 120 "PARENT::bigp::r4c3::reply foreground child with a 40 KiB prompt." | grep -o 'saw=[^"]*' | cut -c1-120
echo "-- C1: fg child with a 100 KiB answer"
run k1 120 "PARENT::fg::r4k1::mid foreground child, 100 KiB answer." | grep -o 'saw=[^"]*\|TERMINAL.*\|TIMEOUT' | cut -c1-120; ledger $(cat runs/$DB/k1.sid)
echo "-- C1: four failing bg children, then a fresh launch"
run e1 120 "PARENT::five::r4e1::error five background children that fail." | grep -o 'saw=[^"]*' | cut -c1-100
S=$(cat runs/$DB/e1.sid); sleep 40; ledger $S
node client.mjs $DB send $S "PARENT::bg::r4e1b::reply one more background child after the failures." | cut -c1-60; sleep 12; modelsaw r4e1b 160
echo "== $(date -u +%T) r4mac DONE"
