#!/bin/bash
# macOS host: candidate arm, long-wait scenario, mutants and a second pass of the PR's E2E loops.
RIG=/rig; cd $RIG
DK="./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=60000 qwen-g1-e2e:latest"
echo "=== $(date +%T) host load: $(uptime | sed 's/.*load averages: //')"
echo "=== $(date +%T) candidate arm (1606fe07 + candidate)"
$DK bash /rig/lin.sh src-cand2 cand2 bash -c 'bash /rig/s2-batch.sh cand2 inflight:none continuation:none inflight:drop-continue-reply continuation:cut-stream inflight:drop-load-reply inflight:load-lost-once; bash /rig/e2e-once.sh --inflight-failover cand2-inflight 3; bash /rig/e2e-once.sh --continuation-failover cand2-continuation 3; bash /rig/e2e-once.sh --session-failover cand2-session 1'
echo "=== $(date +%T) mutants (host load: $(uptime | sed 's/.*load averages: //'))"
./dk.sh qwen-g1-e2e:latest bash /rig/mut/e2e-mutants.sh T00 T01 T02 T03 T04 T07 J02
echo "=== $(date +%T) lost :start, long wait (host load: $(uptime | sed 's/.*load averages: //'))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=240000 qwen-g1-e2e:latest bash /rig/lin.sh src-new new bash /rig/s2-batch.sh new inflight:start-fail-once
echo "=== $(date +%T) E2E loops, second pass (host load: $(uptime | sed 's/.*load averages: //'))"
./dk.sh qwen-g1-e2e:latest bash /rig/lin.sh src-new new bash -c 'bash /rig/e2e-once.sh --inflight-failover new2-inflight 10; bash /rig/e2e-once.sh --continuation-failover new2-continuation 10; bash /rig/e2e-once.sh --session-failover new2-session 3'
echo "=== $(date +%T) BATCH-B-DONE (host load: $(uptime | sed 's/.*load averages: //'))"
