#!/bin/bash
# usage: batch-r2.sh <arm>   — round-2 matrix for one arm, sequential
A=$1; R=/Users/wenshao/pr13219-rig
SC="turn-budget refusal-budget protocol-poison turn-poison ambiguous-admitted turn-409-in-progress turn-409-required turn-cancel-before-fail gap-mid gap-terminal close-harness-down close-harness-restart close-live-writer action-budget seal-once seal-always boot poison-backoff"
for s in $SC; do
  echo "=== $(date +%T) $A $s" >> $R/out/batch-r2-$A.log
  node $R/rig/driver.mjs $A $s r2-$A-$s > $R/runs/r2-$A-$s.out 2>&1
  tail -1 $R/runs/r2-$A-$s.out >> $R/out/batch-r2-$A.log
done
if [ "$A" = head ]; then
  echo "=== $(date +%T) upgrade-inflight" >> $R/out/batch-r2-$A.log
  node $R/rig/driver.mjs base upgrade-inflight r2-upgrade-inflight > $R/runs/r2-upgrade-inflight.out 2>&1
  tail -1 $R/runs/r2-upgrade-inflight.out >> $R/out/batch-r2-$A.log
  echo "=== $(date +%T) turn-budget-default" >> $R/out/batch-r2-$A.log
  node $R/rig/driver.mjs head turn-budget-default r2-head-turn-budget-default > $R/runs/r2-head-turn-budget-default.out 2>&1
  tail -1 $R/runs/r2-head-turn-budget-default.out >> $R/out/batch-r2-$A.log
fi
echo "BATCH-DONE $(date +%T)" >> $R/out/batch-r2-$A.log
