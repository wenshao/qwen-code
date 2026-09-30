#!/bin/bash
# container: run both failover modes once per mutant arm; print exit code and the runner's own failure line.
O=/rig/out/mut; mkdir -p $O
for id in "$@"; do
  W=/w/mut-$id
  rm -rf $W; mkdir -p $W && cp -a /rig/mut/arm-$id/. $W/
  cd $W
  for mode in inflight continuation; do
    s=$(date +%s)
    tsx scripts/run-managed-agent-server-e2e.ts --$mode-failover > $O/e2e-$id-$mode.out 2> $O/e2e-$id-$mode.err; rc=$?
    why=$(grep -m1 -E "^Error: " $O/e2e-$id-$mode.err | cut -c1-420)
    echo "[$id] $mode exit=$rc $(( $(date +%s) - s ))s ${why}"
  done
done
echo "[mutants] DONE"
