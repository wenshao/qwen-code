#!/bin/bash
# macOS host: PR #13350 core A/B on the real stack (Linux VM). usage: batch-a.sh <arm...>
RIG=/Users/wenshao/pr13350-rig; cd $RIG
load() { uptime | sed 's/.*load averages: //'; }
for ARM in "$@"; do
  echo "=== $(date +%T) $ARM lost-reply matrix (host load: $(load))"
  ./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=75000 -e RIG_WRITER_LEASE=8s -e RIG_STORE_LOG=1 qwen-g1-e2e:latest bash /rig/lin.sh src-$ARM $ARM bash /rig/s2-batch.sh $ARM continuation:drop-load-reply inflight:drop-load-reply
  ./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=75000 -e RIG_WRITER_LEASE=8s -e RIG_STORE_LOG=1 -e RIG_CANCEL=public qwen-g1-e2e:latest bash /rig/lin.sh src-$ARM $ARM bash /rig/s2-batch.sh $ARM inflight:db-cancel-drop-load-reply continuation:db-cancel-drop-load-reply
  ./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=100000 -e RIG_WRITER_LEASE=8s -e RIG_STORE_LOG=1 -e RIG_REQ_TIMEOUT=10s -e RIG_START_DELAY_MS=15000 qwen-g1-e2e:latest bash /rig/lin.sh src-$ARM $ARM bash /rig/s2-batch.sh $ARM inflight:slow-load
done
echo "=== $(date +%T) BATCH-A-DONE (host load: $(load))"
