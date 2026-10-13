#!/bin/bash
i=0; pids=()
for spec in base:killz pr:killz ca:killz cb:killz ca:kill cb:kill; do
  a=${spec%%:*}; m=${spec#*:}; i=$((i+1))
  /rig/cwdz.sh $a $((15140+i)) 30 $m > /rig/out/phase-cwdz-$a-$m.out 2>&1 & pids+=($!)
  if [ $((i % 2)) = 0 ]; then wait "${pids[@]}"; pids=(); fi
done
wait
for spec in base:killz pr:killz ca:killz cb:killz ca:kill cb:kill; do cat /rig/out/phase-cwdz-${spec%%:*}-${spec#*:}.out; done
echo PHASE4-DONE
