#!/bin/bash
# macOS host: how long does a taken-over Turn that asks for a second tool stay open? (5 min observation, head)
# (The next-owner probe was dropped: Workspace Sessions take one Turn through the public API, submitTurn -> 409 workspace_unavailable.)
RIG=/Users/wenshao/pr13083-rig; cd $RIG
echo "=== $(date +%T) second tool round, 5 min observation (host load: $(uptime | sed 's/.*load averages: //'))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=300000 -e RIG_SECOND_TOOL=1 -e RIG_SECOND=0 qwen-g1-e2e:latest bash /rig/lin.sh src-h7 h7 bash /rig/s2-batch.sh h7st5 inflight:none
echo "=== $(date +%T) BATCH-H7G-DONE"
