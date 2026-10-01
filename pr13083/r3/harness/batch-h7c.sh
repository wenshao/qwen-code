#!/bin/bash
# macOS host: round-3 candidate arm (file history settled after a driven takeover).
RIG=/Users/wenshao/pr13083-rig; cd $RIG
echo "=== $(date +%T) candidate: file history, cold load (host load: $(uptime | sed 's/.*load averages: //'))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 -e RIG_FILE_HISTORY=1 -e RIG_COLD_LOAD=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h7-cand h7cand bash /rig/s2-batch.sh h7candcl inflight:none continuation:none
echo "=== $(date +%T) candidate: second tool round"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 -e RIG_FILE_HISTORY=1 -e RIG_SECOND_TOOL=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h7-cand h7cand bash /rig/s2-batch.sh h7candst inflight:none
echo "=== $(date +%T) candidate: runner modes"
./dk.sh qwen-g1-e2e:latest bash /rig/lin.sh src-h7-cand h7cand bash -c 'bash /rig/e2e-once.sh --inflight-failover h7cand-inflight 3; bash /rig/e2e-once.sh --continuation-failover h7cand-continuation 3'
echo "=== $(date +%T) BATCH-H7C-DONE"
