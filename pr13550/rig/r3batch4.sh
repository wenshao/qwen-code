#!/bin/bash
DB=r3m; . /Users/wenshao/git/pr13550-rig/r3lib.sh
./sc.sh $DB h1 120 "PARENT::bg::h1::hold70 background child held for 70 seconds." | tail -1; S=$(cat runs/$DB/h1.sid)
for t in 20 40 60; do sleep 20; echo "t+${t}s ledger: $(sq "SELECT state, attempts, IFNULL(last_error,'-') FROM qwen_managed_child_result_relay WHERE parent_session_id='$S'")"; done
sleep 10; date -u +%T.%N | cut -c1-12; curl -s http://127.0.0.1:18551/release/h1; consumed_wait $S 60; date -u +%T.%N | cut -c1-12; ledger $S
echo "== $(date -u +%T) batch4 DONE"
