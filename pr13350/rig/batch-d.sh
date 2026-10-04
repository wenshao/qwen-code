#!/bin/bash
# macOS host: runner-proxy diagnosis + late duplicate load probe (head, merge, active-guard mutant).
RIG=/Users/wenshao/pr13350-rig; cd $RIG
load() { uptime | sed 's/.*load averages: //'; }
RUN='cp /rig/runner-x5-diag.frozen.ts scripts/run-managed-agent-server-e2e.ts'
echo "=== $(date +%T) issue runner, diagnostic copy: buffered proxy, 120 s wait (host load: $(load))"
./dk.sh -e RIG_TLL_WAIT_MS=120000 -e RIG_TLL_DIAG=/rig/out/e2e/head-tll-buffered qwen-g1-e2e:latest bash /rig/lin.sh src-head head bash -c "$RUN; bash /rig/e2e-once.sh --takeover-load-loss head-tlld-buffered 1"
echo "=== $(date +%T) issue runner, diagnostic copy: streaming proxy (host load: $(load))"
for ARM in head merge base; do
  ./dk.sh -e RIG_TLL_STREAM=1 -e RIG_TLL_WAIT_MS=90000 -e RIG_TLL_DIAG=/rig/out/e2e/$ARM-tll-stream qwen-g1-e2e:latest bash /rig/lin.sh src-$ARM $ARM bash -c "$RUN; bash /rig/e2e-once.sh --takeover-load-loss $ARM-tlld-stream 2"
done
echo "=== $(date +%T) late duplicate takeover load during the continuation (host load: $(load))"
for ARM in head merge mut6; do
  ./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=75000 -e RIG_WRITER_LEASE=8s -e RIG_STORE_LOG=1 -e RIG_LATE_LOAD=1 qwen-g1-e2e:latest bash /rig/lin.sh src-$ARM $ARM bash /rig/s2-batch.sh $ARM-late continuation:drop-load-reply
done
echo "=== $(date +%T) BATCH-D-DONE (host load: $(load))"
