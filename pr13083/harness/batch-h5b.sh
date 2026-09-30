#!/bin/bash
# macOS host: re-run of fifth-head scenarios that did not reach a verdict (owner start-up timeouts under host load).
RIG=/rig; cd $RIG
echo "=== $(date +%T) 13cbd974 re-runs (host load: $(uptime | sed 's/.*load averages: //'))"
./dk.sh -e RIG_OUT=/rig/out/s2 -e RIG_WAIT_MS=90000 qwen-g1-e2e:latest bash /rig/lin.sh src-h5 h5 bash /rig/s2-batch.sh h5 "$@"
echo "=== $(date +%T) BATCH-H5B-DONE (host load: $(uptime | sed 's/.*load averages: //'))"
