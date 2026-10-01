#!/bin/bash
# E4: natural runs on 3 pinned cores (macOS-runner-sized) with 6 busy loops
# pinned to the same cores. Busy-loop PIDs are recorded and killed by PID.
ROOT=/root/verify/pr12930
PIDS=()
for i in 1 2 3 4 5 6; do taskset -c 0-2 node -e 'for(;;){}' & PIDS+=($!); done
echo "busy pids: ${PIDS[*]}" > $ROOT/stress.pids
export WRAP="taskset -c 0-2"
for i in $(seq -w 1 15); do $ROOT/harness/run-arm.sh base none e4-base-$i; $ROOT/harness/run-arm.sh head none e4-head-$i; done
for p in "${PIDS[@]}"; do kill $p; done
echo STRESS_DONE
