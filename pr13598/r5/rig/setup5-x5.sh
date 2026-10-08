#!/bin/bash
# Round 5 control, no automation: X1's user read_file Turn holds the Workspace lease (tap holds its
# execution poll), X2's user read_file Turn waits on workspace_busy, then the Harness is SIGKILLed and restarted.
cd /Users/wenshao/git/pr13598-rig
source mk4.sh
L=runs/x5/actions.log
mks x5 X1 2>/dev/null; mks x5 X2 2>/dev/null; sleep 12
curl -s -XPOST localhost:36226/rule -d '{"pathRe":"executions/[^:?/]+\\?","action":"delay","ms":150000,"count":1}'; echo
nohup ./crash5.sh x5 "X1 user Turn mid tool, X2 waiting on the lease" >/dev/null 2>&1 &
sleep 1
echo "$(date -u +%T) X1 user read_file Turn" >> $L
node client.mjs x5 send $(cat runs/x5/X1) "USER::x1-tool $TOOLP" | grep -E '"turn_id"' | head -1 >> $L
sleep 3
echo "$(date -u +%T) X2 user read_file Turn" >> $L
node client.mjs x5 send $(cat runs/x5/X2) "USER::x2-tool $TOOLP" | grep -E '"turn_id"' | head -1 >> $L
until grep -q restarted $L; do sleep 1; done
sleep 150
echo "$(date -u +%T) X2 follow-up Turn" >> $L
node client.mjs x5 send $(cat runs/x5/X2) "USER::x2-next Reply with exactly: PONG" | grep -E '"turn_id"' | head -1 >> $L
echo "$(date -u +%T) x5 done" >> $L
