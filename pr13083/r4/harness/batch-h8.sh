#!/bin/bash
# macOS host: round 4 on head 7ae1fa05, Linux VM.
RIG=/Users/wenshao/pr13083-rig; cd $RIG
load() { uptime | sed 's/.*load averages: //'; }
echo "=== $(date +%T) 7ae1fa05 takeover matrix + file history + cold load (host load: $(load))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 -e RIG_FILE_HISTORY=1 -e RIG_COLD_LOAD=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h8 h8 bash /rig/s2-batch.sh h8 inflight:none continuation:none continuation:cut-stream inflight:drop-continue-reply inflight:drop-load-reply inflight:load-lost-once first-round:none
echo "=== $(date +%T) second tool round + file history (host load: $(load))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 -e RIG_FILE_HISTORY=1 -e RIG_SECOND_TOOL=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h8 h8 bash /rig/s2-batch.sh h8st inflight:none continuation:none continuation:cut-stream inflight:drop-continue-reply inflight:load-lost-once
echo "=== $(date +%T) cancel path via the store transition, head vs round-3 head (host load: $(load))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=90000 -e RIG_FILE_HISTORY=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h8 h8 bash /rig/s2-batch.sh h8 inflight:db-cancel inflight:db-cancel-drop-reply continuation:db-cancel
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=90000 -e RIG_FILE_HISTORY=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h7 h7 bash /rig/s2-batch.sh h7 inflight:db-cancel inflight:db-cancel-drop-reply continuation:db-cancel
echo "=== $(date +%T) runner modes (host load: $(load))"
./dk.sh qwen-g1-e2e:latest bash /rig/lin.sh src-h8 h8 bash -c 'bash /rig/e2e-once.sh --inflight-failover h8-inflight 10; bash /rig/e2e-once.sh --continuation-failover h8-continuation 10; bash /rig/e2e-once.sh --session-failover h8-session 3'
echo "=== $(date +%T) lost :start, long wait (host load: $(load))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=240000 -e RIG_FILE_HISTORY=1 -e RIG_COLD_LOAD=1 qwen-g1-e2e:latest bash /rig/lin.sh src-h8 h8 bash /rig/s2-batch.sh h8 inflight:start-fail-once
echo "=== $(date +%T) two Turns, stream gap, multi-line text on Linux"
./dk.sh -e RIG_OUT=/rig/out/s1 qwen-g1-e2e:latest bash /rig/lin.sh src-h8 h8 bash -c 'cp /rig/rig/*.ts /w/rig/; tsx /w/rig/s1-two-turn.ts h8-linux-unbound unbound > /rig/out/s1/h8-linux-unbound.console 2>&1; echo "s1 exit=$?"; RIG_OUT=/rig/out/s1c tsx /w/rig/s1c-stream-gap.ts h8-linux > /rig/out/s1c/h8-linux.console 2>&1; echo "s1c exit=$?"; RIG_OUT=/rig/out/s8 tsx /w/rig/s8-multiline.ts h8-linux > /rig/out/s8/h8-linux.console 2>&1; echo "s8 exit=$?"'
echo "=== $(date +%T) BATCH-H8-DONE (host load: $(load))"
