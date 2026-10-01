#!/bin/bash
# macOS host: round 4 candidate C (passive takeover adopts the Runtime Session) on the cancel path.
RIG=/Users/wenshao/pr13083-rig; cd $RIG
load() { uptime | sed 's/.*load averages: //'; }
echo "=== $(date +%T) candidate C: cancel path via the store transition (host load: $(load))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=90000 -e RIG_FILE_HISTORY=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h8-cand h8cand bash /rig/s2-batch.sh h8c inflight:db-cancel inflight:db-cancel-drop-reply continuation:db-cancel continuation:db-cancel-drop-reply
echo "=== $(date +%T) candidate C: drive path unchanged"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 -e RIG_FILE_HISTORY=1 -e RIG_SECOND_TOOL=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h8-cand h8cand bash /rig/s2-batch.sh h8c inflight:none continuation:none
./dk.sh qwen-g1-e2e:latest bash /rig/lin.sh src-h8-cand h8cand bash -c 'bash /rig/e2e-once.sh --inflight-failover h8cand-inflight 3; bash /rig/e2e-once.sh --continuation-failover h8cand-continuation 3'
echo "=== $(date +%T) head: continuation cancel with a lost reply (host load: $(load))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=90000 -e RIG_FILE_HISTORY=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h8 h8 bash /rig/s2-batch.sh h8 continuation:db-cancel-drop-reply
echo "=== $(date +%T) BATCH-H8B-DONE"
