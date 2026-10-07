#!/bin/bash
# Sequential scenario queue: fixed ports 18443/18444/18500, one run at a time.
set -u
cd "$(dirname "$0")"
CAP="node /Users/cici/git/qwen-code-x6/scripts/verify-capture.mjs"
E=../evidence

echo "===== S2 media A/B ====="
$CAP --out $E/02-ab-media.png --title 'S2 A/B: inbound image under thread scope — base (per-sender) vs head (group-shared, isolated)' --rows 90 -- bash -c 'node scenarios/s2-media.cjs base; node scenarios/s2-media.cjs head'

echo "===== S3 media-steer A/B ====="
$CAP --out $E/03-ab-steer.png --title 'S3 A/B: operator image steers a streaming turn — cancelled partial keeps its own msg_id (head)' --rows 80 -- bash -c 'node scenarios/s3-media-steer.cjs base; node scenarios/s3-media-steer.cjs head'

echo "===== S5 operators: base-zero head-zero head-ops ====="
$CAP --out $E/04-operators.png --title 'S5 Finding-1 re-measure: untouched group, approval-gated tool — base-zero vs head-zero vs head+operators' --rows 120 -- bash -c 'node scenarios/s5-operators.cjs base zero; node scenarios/s5-operators.cjs head zero; node scenarios/s5-operators.cjs head ops'

echo "===== S5b wedge (head, 300 s timeout window) ====="
$CAP --out $E/05-wedge.png --title 'S5b Finding-1 re-measure: how long one unanswerable prompt wedges the group (head)' --rows 50 -- bash -c 'node scenarios/s5b-wedge.cjs head'

echo "===== QUEUE DONE ====="
