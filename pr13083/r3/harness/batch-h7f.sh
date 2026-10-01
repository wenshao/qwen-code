#!/bin/bash
# macOS host: next Turn on the next owner after a taken-over Turn (fixed probe), head vs A+B candidate.
RIG=/Users/wenshao/pr13083-rig; cd $RIG
echo "=== $(date +%T) next owner (host load: $(uptime | sed 's/.*load averages: //'))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 -e RIG_NEXT_OWNER=1 -e RIG_SECOND=0 qwen-g1-e2e:latest bash /rig/lin.sh src-h7 h7 bash /rig/s2-batch.sh h7no inflight:none continuation:none
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 -e RIG_NEXT_OWNER=1 -e RIG_SECOND=0 qwen-g1-e2e:latest bash /rig/lin.sh src-h7-cand h7cand2 bash /rig/s2-batch.sh h7c2no inflight:none
echo "=== $(date +%T) candidate A+B: in-flight runner again"
./dk.sh qwen-g1-e2e:latest bash /rig/lin.sh src-h7-cand h7cand2 bash -c 'bash /rig/e2e-once.sh --inflight-failover h7cand2b-inflight 5'
echo "=== $(date +%T) BATCH-H7F-DONE"
