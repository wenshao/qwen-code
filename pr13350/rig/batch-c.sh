#!/bin/bash
# macOS host: mutant + base contrast + the issue's own runner mode + plain-path non-regression.
RIG=/Users/wenshao/pr13350-rig; cd $RIG
load() { uptime | sed 's/.*load averages: //'; }
echo "=== $(date +%T) mutant (acquire-only guard removed): transient re-acquire failure (host load: $(load))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=75000 -e RIG_WRITER_LEASE=8s -e RIG_STORE_LOG=1 -e RIG_ACQUIRE_FAIL_NTH=2 qwen-g1-e2e:latest bash /rig/lin.sh src-mut mut bash /rig/s2-batch.sh mut-acqfail continuation:drop-load-reply inflight:drop-load-reply
echo "=== $(date +%T) base: direct redrive probe (host load: $(load))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=75000 -e RIG_WRITER_LEASE=8s -e RIG_STORE_LOG=1 -e RIG_PROBE=1 qwen-g1-e2e:latest bash /rig/lin.sh src-base base bash /rig/s2-batch.sh base-probe continuation:drop-load-reply
echo "=== $(date +%T) plain takeover (no fault) non-regression (host load: $(load))"
for ARM in base head merge; do
  ./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=75000 -e RIG_WRITER_LEASE=8s qwen-g1-e2e:latest bash /rig/lin.sh src-$ARM $ARM bash /rig/s2-batch.sh $ARM continuation:none inflight:none
done
echo "=== $(date +%T) issue runner --takeover-load-loss (host load: $(load))"
for ARM in base head merge; do
  ./dk.sh qwen-g1-e2e:latest bash /rig/lin.sh src-$ARM $ARM bash -c "cp scripts/run-managed-agent-server-e2e-x5.ts scripts/run-managed-agent-server-e2e.ts; bash /rig/e2e-once.sh --takeover-load-loss $ARM-tll 2"
done
echo "=== $(date +%T) PR runner failover modes on head/merge (host load: $(load))"
for ARM in head merge; do
  ./dk.sh qwen-g1-e2e:latest bash /rig/lin.sh src-$ARM $ARM bash -c "bash /rig/e2e-once.sh --continuation-failover $ARM-cf 3; bash /rig/e2e-once.sh --inflight-failover $ARM-if 3"
done
echo "=== $(date +%T) BATCH-C-DONE (host load: $(load))"
