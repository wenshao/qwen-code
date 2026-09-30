#!/bin/bash
# macOS host: head 13cbd974 (PR arm and candidate arm), Linux VM.
RIG=/rig; cd $RIG
DK="./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 qwen-g1-e2e:latest"
echo "=== $(date +%T) 13cbd974 PR arm (host load: $(uptime | sed 's/.*load averages: //'))"
$DK bash /rig/lin.sh src-h5 h5 bash -c 'bash /rig/s2-batch.sh h5 inflight:none continuation:none continuation:cut-stream inflight:drop-continue-reply inflight:drop-load-reply first-round:none inflight:cancel inflight:load-lost-once; bash /rig/e2e-once.sh --inflight-failover h5-inflight 5; bash /rig/e2e-once.sh --continuation-failover h5-continuation 5; bash /rig/e2e-once.sh --session-failover h5-session 2'
echo "=== $(date +%T) 13cbd974 + candidate (host load: $(uptime | sed 's/.*load averages: //'))"
$DK bash /rig/lin.sh src-h5-cand h5cand bash -c 'bash /rig/s2-batch.sh h5cand inflight:none continuation:none continuation:cut-stream inflight:drop-continue-reply inflight:drop-load-reply; bash /rig/e2e-once.sh --inflight-failover h5cand-inflight 3; bash /rig/e2e-once.sh --continuation-failover h5cand-continuation 3; bash /rig/e2e-once.sh --session-failover h5cand-session 1'
echo "=== $(date +%T) lost :start, long wait (host load: $(uptime | sed 's/.*load averages: //'))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=240000 qwen-g1-e2e:latest bash /rig/lin.sh src-h5 h5 bash /rig/s2-batch.sh h5 inflight:start-fail-once
echo "=== $(date +%T) two Turns and stream gap on Linux"
./dk.sh -e RIG_OUT=/rig/out/s1 qwen-g1-e2e:latest bash /rig/lin.sh src-h5 h5 bash -c 'cp /rig/rig/*.ts /w/rig/; tsx /w/rig/s1-two-turn.ts h5-linux-unbound unbound > /rig/out/s1/h5-linux-unbound.console 2>&1; echo "s1 exit=$?"; RIG_OUT=/rig/out/s1c tsx /w/rig/s1c-stream-gap.ts h5-linux > /rig/out/s1c/h5-linux.console 2>&1; echo "s1c exit=$?"'
echo "=== $(date +%T) BATCH-H5-DONE (host load: $(uptime | sed 's/.*load averages: //'))"
