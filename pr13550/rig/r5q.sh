#!/bin/bash
DB=r5q; . /Users/wenshao/git/pr13550-rig/r3lib.sh
texts() { ./mysql.sh sql -N -B $DB -e "SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='$1' AND kind='managed-message' ORDER BY created_at" | grep -o '"role":"model","parts":\[{"text":"[^"]*"' | tail -2 | cut -c1-220; }
./sc.sh $DB q1 300 "Use the agent tool exactly once to delegate a calculation to a child agent, and wait for it (set run_in_background to false). Give the child this complete prompt: 'Compute 37*43 and reply with only the number.' After the child answers, reply to me with 'CHILD SAID: <its answer>'." | grep -E 'TERMINAL|TIMEOUT' | cut -c1-80
S=$(cat runs/$DB/q1.sid); texts $S; sleep 3; ledger $S
./sc.sh $DB q2 300 "Use the agent tool exactly once with run_in_background set to true, giving the child this complete prompt: 'Compute 19*29 and reply with only the number.' Then immediately end your turn by replying only 'LAUNCHED'. Later, when the child's completion notification arrives, reply 'BACKGROUND RESULT: <number>'." | grep -E 'TERMINAL|TIMEOUT' | cut -c1-80
S=$(cat runs/$DB/q2.sid); consumed_wait $S 180; sleep 20; texts $S; ledger $S
./sc.sh $DB n2 600 "List the files in the working directory with ls -la. Then hand the job of running pwd to a child agent and wait for what it says. Tell me both results." | grep -E 'TERMINAL|TIMEOUT' | cut -c1-80
S=$(cat runs/$DB/n2.sid); for i in $(seq 60); do n=$(sq "SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='$S' AND delivery_state='consumed'"); [ "$n" -ge 2 ] && break; sleep 2; done; sleep 25
python3 msgs.py $DB $S | grep -E "CALL|RESULT|text" | cut -c16-230; ledger $S
echo "== $(date -u +%T) r5q DONE"
