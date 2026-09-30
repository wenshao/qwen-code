#!/bin/bash
# macOS host: core evidence for the new head, sequentially in the dedicated VM.
RIG=/rig; cd $RIG; mkdir -p out/e2e out/s2 out/s1 out/s1c
DK="./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 qwen-g1-e2e:latest"
echo "=== $(date +%T) E2E loops (PR's own runner) on 1606fe07"
$DK bash /rig/lin.sh src-new new bash -c 'bash /rig/e2e-once.sh --inflight-failover new-inflight 10; bash /rig/e2e-once.sh --continuation-failover new-continuation 10; bash /rig/e2e-once.sh --session-failover new-session 3'
echo "=== $(date +%T) S2 matrix on 1606fe07"
$DK bash /rig/lin.sh src-new new bash /rig/s2-batch.sh new inflight:none continuation:none first-round:none inflight:load-lost-once inflight:drop-load-reply inflight:drop-continue-reply continuation:cut-stream inflight:cancel
echo "=== $(date +%T) S1/S1c on Linux, 1606fe07"
./dk.sh -e RIG_OUT=/rig/out/s1 qwen-g1-e2e:latest bash /rig/lin.sh src-new new bash -c 'cp /rig/rig/*.ts /w/rig/; tsx /w/rig/s1-two-turn.ts new-linux-unbound unbound > /rig/out/s1/new-linux-unbound.console 2>&1; echo "s1 exit=$?"; RIG_OUT=/rig/out/s1c tsx /w/rig/s1c-stream-gap.ts new-linux > /rig/out/s1c/new-linux.console 2>&1; echo "s1c exit=$?"'
echo "=== $(date +%T) BATCH-A-DONE"
