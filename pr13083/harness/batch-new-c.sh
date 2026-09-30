#!/bin/bash
# macOS host: connector-fix-only arm (shows what the continue replay does once F1 is out of the way) and leftovers.
RIG=/rig; cd $RIG
echo "=== $(date +%T) connector-fix-only arm (host load: $(uptime | sed 's/.*load averages: //'))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 qwen-g1-e2e:latest bash /rig/lin.sh src-candA candA bash /rig/s2-batch.sh candA inflight:drop-continue-reply
echo "=== $(date +%T) public cancel of a parked Workspace Turn"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 qwen-g1-e2e:latest bash /rig/lin.sh src-new new bash /rig/s2-batch.sh new inflight:cancel
echo "=== $(date +%T) BATCH-C-DONE (host load: $(uptime | sed 's/.*load averages: //'))"
