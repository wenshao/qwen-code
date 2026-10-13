#!/bin/bash
# usage: stress.sh <phase> <seconds> <hogs>
phase=$1; secs=$2; hogs=$3
hogpids=()
for ((i=0;i<hogs;i++)); do (exec yes > /dev/null) & hogpids+=($!); done
pids=()
for a in base head cand; do
  /rig/run-arm.sh $a ProbeRaceStressTest -Dstress.seconds=$secs > /rig/stress-$phase-$a.log 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait $p; done
for p in "${hogpids[@]}"; do kill $p; done
for a in base head cand; do grep -h -E "^RESULT|^SAMPLE" /rig/stress-$phase-$a.log; done
echo "PHASE-DONE $phase"
