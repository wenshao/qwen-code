#!/bin/bash
DB=r4c; . /Users/wenshao/git/pr13550-rig/r3lib.sh
./sc.sh $DB k1 240 "PARENT::fg::r4k1::mid foreground child, 100 KiB answer." | grep -o 'saw=[^"]*\|TERMINAL.*\|TIMEOUT' | cut -c1-200; sleep 3; ledger $(cat runs/$DB/k1.sid)
./sc.sh $DB k2 120 "PARENT::five::r4k2::error five background children that fail." | grep -o 'saw=[^"]*\|TERMINAL.*' | cut -c1-120
S=$(cat runs/$DB/k2.sid); sleep 25; ledger $S
node client.mjs $DB send $S "PARENT::bg::r4k2b::reply one more background child after the failures." | cut -c1-60
sleep 12; modelsaw r4k2b 200; ledger $S
./sc.sh $DB k3 120 "PARENT::bg::r4k3::reply ordinary background child." | tail -1; S=$(cat runs/$DB/k3.sid); consumed_wait $S 60; sleep 4; ledger $S
echo "== $(date -u +%T) cand DONE"
