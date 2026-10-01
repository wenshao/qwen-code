#!/bin/bash
# macOS host: user-visible impact on b4e9d71b, the A+B candidate, and the second tool round on the round-2 head.
RIG=/Users/wenshao/pr13083-rig; cd $RIG
echo "=== $(date +%T) head: next Turn after a Harness restart (host load: $(uptime | sed 's/.*load averages: //'))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 -e RIG_COLD_TURN=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h7 h7 bash /rig/s2-batch.sh h7ct inflight:none continuation:none
echo "=== $(date +%T) round-2 head 912c3b57: second tool round"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 -e RIG_SECOND_TOOL=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h6 h6 bash /rig/s2-batch.sh h6st inflight:none continuation:none
echo "=== $(date +%T) candidate A+B: second tool round, file history, next Turn after restart"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 -e RIG_SECOND_TOOL=1 -e RIG_FILE_HISTORY=1 -e RIG_COLD_TURN=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h7-cand h7cand2 bash /rig/s2-batch.sh h7c2 inflight:none continuation:none continuation:cut-stream inflight:drop-continue-reply
echo "=== $(date +%T) candidate A+B: runner modes"
./dk.sh qwen-g1-e2e:latest bash /rig/lin.sh src-h7-cand h7cand2 bash -c 'bash /rig/e2e-once.sh --inflight-failover h7cand2-inflight 5; bash /rig/e2e-once.sh --continuation-failover h7cand2-continuation 5; bash /rig/e2e-once.sh --session-failover h7cand2-session 2'
echo "=== $(date +%T) BATCH-H7D-DONE"
