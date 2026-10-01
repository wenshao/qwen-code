#!/bin/bash
# macOS host: file history and cold load after takeover on b4e9d71b.
RIG=/Users/wenshao/pr13083-rig; cd $RIG
echo "=== $(date +%T) cold load after takeover (host load: $(uptime | sed 's/.*load averages: //'))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 -e RIG_FILE_HISTORY=1 -e RIG_COLD_LOAD=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h7 h7 bash /rig/s2-batch.sh h7cl inflight:none continuation:none inflight:load-lost-once
echo "=== $(date +%T) second tool round after takeover"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 -e RIG_FILE_HISTORY=1 -e RIG_SECOND_TOOL=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h7 h7 bash /rig/s2-batch.sh h7st inflight:none continuation:none
echo "=== $(date +%T) BATCH-H7B-DONE"
