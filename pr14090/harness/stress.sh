#!/bin/bash
# usage: stress.sh <phase> <seconds> <hogs>  -- base and pr loop the stock test body side by side
phase=$1; secs=$2; hogs=$3
hogpids=()
for ((i=0;i<hogs;i++)); do (exec yes > /dev/null) & hogpids+=($!); done
/rig/run-arm.sh base ProbeRaceStressTest -Dstress.seconds=$secs > /rig/out/stress-$phase-base.log 2>&1 & p1=$!
/rig/run-arm.sh pr ProbeRaceStressTest -Dstress.seconds=$secs > /rig/out/stress-$phase-pr.log 2>&1 & p2=$!
wait $p1 $p2
for p in "${hogpids[@]}"; do kill $p; done
for a in base pr; do grep -h -E "^RESULT|^SAMPLE" /rig/out/stress-$phase-$a.log; done
echo "PHASE-DONE $phase"
