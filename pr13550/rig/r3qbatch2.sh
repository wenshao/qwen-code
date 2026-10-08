#!/bin/bash
DB=r3q; . /Users/wenshao/git/pr13550-rig/r3lib.sh
echo "-- n2: a natural request with no tool-argument constraints"
./sc.sh $DB n2 600 "List the files in the working directory with ls -la. Then hand the job of running pwd to a child agent and wait for what it says. Tell me both results." | grep -E 'TERMINAL|TIMEOUT' | cut -c1-120
S=$(cat runs/$DB/n2.sid); sleep 5; python3 msgs.py $DB $S | cut -c1-280
for i in $(seq 60); do n=$(sq "SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='$S' AND delivery_state='consumed'"); [ "$n" -ge 2 ] && break; sleep 2; done; sleep 25
echo "-- n2 after any wake:"; python3 msgs.py $DB $S | tail -n 4 | cut -c1-400; ledger $S
echo "== $(date -u +%T) qbatch2 DONE"
