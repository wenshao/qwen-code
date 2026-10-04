#!/bin/bash
# macOS host: PR #13350 deeper probes. usage: batch-b.sh <arm...>
RIG=/Users/wenshao/pr13350-rig; cd $RIG
load() { uptime | sed 's/.*load averages: //'; }
for ARM in "$@"; do
  echo "=== $(date +%T) $ARM transient re-acquire failure on the redrive (host load: $(load))"
  ./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=75000 -e RIG_WRITER_LEASE=8s -e RIG_STORE_LOG=1 -e RIG_ACQUIRE_FAIL_NTH=2 qwen-g1-e2e:latest bash /rig/lin.sh src-$ARM $ARM bash /rig/s2-batch.sh $ARM-acqfail continuation:drop-load-reply inflight:drop-load-reply
  echo "=== $(date +%T) $ARM concurrent direct redrives + plain load + create (host load: $(load))"
  ./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=90000 -e RIG_WRITER_LEASE=8s -e RIG_STORE_LOG=1 -e RIG_PROBE=1 qwen-g1-e2e:latest bash /rig/lin.sh src-$ARM $ARM bash /rig/s2-batch.sh $ARM-probe continuation:drop-load-reply inflight:drop-load-reply
done
echo "=== $(date +%T) BATCH-B-DONE (host load: $(load))"
