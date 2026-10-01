#!/bin/bash
# E4: natural runs on 3 pinned cores (macOS-runner-sized) with 6 busy loops
# pinned to the same cores. Busy-loop PIDs are recorded and killed by PID.
ROOT=/root/verify/pr12930
PIDS=()
for i in $(seq 1 10); do taskset -c 0-1 node -e 'for(;;){}' & PIDS+=($!); done
echo "busy pids: ${PIDS[*]}" > $ROOT/stress5.pids
export WRAP="taskset -c 0-1"
for i in $(seq -w 1 20); do $ROOT/harness/run-arm.sh base none e5-base-$i; $ROOT/harness/run-arm.sh head none e5-head-$i; done
for p in "${PIDS[@]}"; do kill $p; done
echo STRESS5_DONE
