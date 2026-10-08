#!/bin/bash
DB=r3q; . /Users/wenshao/git/pr13550-rig/r3lib.sh
texts() { ./mysql.sh sql -N -B $DB -e "SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='$1' AND kind='managed-message' ORDER BY created_at" | grep -o '"role":"model","parts":\[{"text":"[^"]*"' | cut -c1-260; }
./sc.sh $DB q1 300 "Use the agent tool exactly once to delegate a calculation to a child agent, and wait for it (set run_in_background to false). Give the child this complete prompt: 'Compute 37*43 and reply with only the number.' After the child answers, reply to me with 'CHILD SAID: <its answer>'." | grep -E 'TERMINAL|TIMEOUT' | cut -c1-120
S=$(cat runs/$DB/q1.sid); texts $S; sleep 3; ledger $S
./sc.sh $DB q3 400 "Use the agent tool exactly once with run_in_background set to false, giving the child this complete prompt: 'Run the shell command: ls -la and reply with the number of entries you saw.' Wait for the child and then reply 'CHILD SAID: <answer>'." | grep -E 'TERMINAL|TIMEOUT' | cut -c1-120
S=$(cat runs/$DB/q3.sid); texts $S; sleep 3; ledger $S
./sc.sh $DB q2 300 "Use the agent tool exactly once with run_in_background set to true, giving the child this complete prompt: 'Compute 19*29 and reply with only the number.' Then immediately end your turn by replying only 'LAUNCHED'. Later, when the child's completion notification arrives, reply 'BACKGROUND RESULT: <number>'." | grep -E 'TERMINAL|TIMEOUT' | cut -c1-120
S=$(cat runs/$DB/q2.sid); consumed_wait $S 180; sleep 20; texts $S; ledger $S; notif $S
echo "-- n1: the round-2 natural F3' shape (ls first, then a foreground child)"
./sc.sh $DB n1 600 "First run the shell command 'ls -la' yourself with the shell tool. After that, use the agent tool exactly once with run_in_background set to false, giving the child this complete prompt: 'Run the shell command: pwd and reply with only its output.' Wait for the child and then reply 'CHILD SAID: <answer>'." | grep -E 'TERMINAL|TIMEOUT' | cut -c1-120
S=$(cat runs/$DB/n1.sid); sleep 5; python3 msgs.py $DB $S | cut -c1-300; ledger $S
for i in $(seq 120); do n=$(sq "SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='$S' AND status IN ('RUNNING','QUEUED','PENDING')"); [ "$n" = 0 ] && break; sleep 2; done; sleep 10
echo "-- n1 after any wake:"; sq "SELECT turn_id, status, IFNULL(error_code,'-') FROM managed_agent_turn WHERE session_id='$S' ORDER BY created_at"; texts $S; ledger $S
echo "== $(date -u +%T) qbatch DONE"
