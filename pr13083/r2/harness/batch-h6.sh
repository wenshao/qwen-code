#!/bin/bash
# macOS host: round 2 on head 912c3b57, Linux VM.
RIG=/rig; cd $RIG
DK="./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 qwen-g1-e2e:latest"
echo "=== $(date +%T) 912c3b57 takeover matrix (host load: $(uptime | sed 's/.*load averages: //'))"
$DK bash /rig/lin.sh src-h6 h6 bash -c 'bash /rig/s2-batch.sh h6 inflight:none continuation:none continuation:cut-stream inflight:drop-continue-reply inflight:drop-load-reply inflight:load-lost-once first-round:none inflight:cancel'
echo "=== $(date +%T) runner modes (host load: $(uptime | sed 's/.*load averages: //'))"
./dk.sh qwen-g1-e2e:latest bash /rig/lin.sh src-h6 h6 bash -c 'bash /rig/e2e-once.sh --inflight-failover h6-inflight 10; bash /rig/e2e-once.sh --continuation-failover h6-continuation 10; bash /rig/e2e-once.sh --session-failover h6-session 3'
echo "=== $(date +%T) lost :start, long wait"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=240000 qwen-g1-e2e:latest bash /rig/lin.sh src-h6 h6 bash /rig/s2-batch.sh h6 inflight:start-fail-once
echo "=== $(date +%T) two Turns, stream gap, multi-line text on Linux"
./dk.sh -e RIG_OUT=/rig/out/s1 qwen-g1-e2e:latest bash /rig/lin.sh src-h6 h6 bash -c 'cp /rig/rig/*.ts /w/rig/; tsx /w/rig/s1-two-turn.ts h6-linux-unbound unbound > /rig/out/s1/h6-linux-unbound.console 2>&1; echo "s1 exit=$?"; RIG_OUT=/rig/out/s1c tsx /w/rig/s1c-stream-gap.ts h6-linux > /rig/out/s1c/h6-linux.console 2>&1; echo "s1c exit=$?"; RIG_OUT=/rig/out/s8 tsx /w/rig/s8-multiline.ts h6-linux > /rig/out/s8/h6-linux.console 2>&1; echo "s8 exit=$?"'
echo "=== $(date +%T) BATCH-H6-DONE (host load: $(uptime | sed 's/.*load averages: //'))"
