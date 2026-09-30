#!/bin/bash
# macOS host: re-run of the key scenarios on head fcd2dc2c (PR arm and candidate arm), Linux VM.
RIG=/rig; cd $RIG
DK="./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 qwen-g1-e2e:latest"
echo "=== $(date +%T) fcd2dc2c PR arm (host load: $(uptime | sed 's/.*load averages: //'))"
$DK bash /rig/lin.sh src-h4 h4 bash -c 'bash /rig/e2e-once.sh --inflight-failover h4-inflight 3; bash /rig/e2e-once.sh --continuation-failover h4-continuation 3; bash /rig/e2e-once.sh --session-failover h4-session 1; bash /rig/s2-batch.sh h4 inflight:none continuation:none continuation:cut-stream inflight:drop-continue-reply inflight:drop-load-reply inflight:cancel'
echo "=== $(date +%T) fcd2dc2c + candidate (host load: $(uptime | sed 's/.*load averages: //'))"
$DK bash /rig/lin.sh src-h4-cand h4cand bash -c 'bash /rig/s2-batch.sh h4cand inflight:none continuation:none continuation:cut-stream inflight:drop-continue-reply; bash /rig/e2e-once.sh --inflight-failover h4cand-inflight 2; bash /rig/e2e-once.sh --continuation-failover h4cand-continuation 2'
echo "=== $(date +%T) BATCH-H4-DONE (host load: $(uptime | sed 's/.*load averages: //'))"
