#!/bin/bash
# macOS host: round 3 on head b4e9d71b, Linux VM.
RIG=/Users/wenshao/pr13083-rig; cd $RIG
DK="./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 -e RIG_FILE_HISTORY=1 qwen-g1-e2e:latest"
echo "=== $(date +%T) b4e9d71b takeover matrix (host load: $(uptime | sed 's/.*load averages: //'))"
$DK bash /rig/lin.sh src-h7 h7 bash -c 'bash /rig/s2-batch.sh h7 inflight:none continuation:none continuation:cut-stream inflight:drop-continue-reply inflight:drop-load-reply inflight:load-lost-once first-round:none'
echo "=== $(date +%T) runner modes (host load: $(uptime | sed 's/.*load averages: //'))"
./dk.sh qwen-g1-e2e:latest bash /rig/lin.sh src-h7 h7 bash -c 'bash /rig/e2e-once.sh --inflight-failover h7-inflight 10; bash /rig/e2e-once.sh --continuation-failover h7-continuation 10; bash /rig/e2e-once.sh --session-failover h7-session 3'
echo "=== $(date +%T) lost :start, long wait"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=240000 -e RIG_FILE_HISTORY=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h7 h7 bash /rig/s2-batch.sh h7 inflight:start-fail-once
echo "=== $(date +%T) two Turns, stream gap, multi-line text on Linux"
./dk.sh -e RIG_OUT=/rig/out/s1 qwen-g1-e2e:latest bash /rig/lin.sh src-h7 h7 bash -c 'cp /rig/rig/*.ts /w/rig/; tsx /w/rig/s1-two-turn.ts h7-linux-unbound unbound > /rig/out/s1/h7-linux-unbound.console 2>&1; echo "s1 exit=$?"; RIG_OUT=/rig/out/s1c tsx /w/rig/s1c-stream-gap.ts h7-linux > /rig/out/s1c/h7-linux.console 2>&1; echo "s1c exit=$?"; RIG_OUT=/rig/out/s8 tsx /w/rig/s8-multiline.ts h7-linux > /rig/out/s8/h7-linux.console 2>&1; echo "s8 exit=$?"'
echo "=== $(date +%T) BATCH-H7-DONE (host load: $(uptime | sed 's/.*load averages: //'))"
