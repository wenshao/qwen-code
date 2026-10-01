#!/bin/bash
# Paired base/pr runs in the same provider window, then latency injection.
H=$(dirname "$0")/run-arm.sh
for i in 1 2 3 4; do $H base 0 n$i-base & $H pr 0 n$i-pr & wait; done
for L in 45000 60000 80000; do
  $H base $L lat$L-base "should call monitor tool" & $H pr $L lat$L-pr "should call monitor tool" & wait
done
# Mutant M2 (monitor.execute always errors) via a qwen shim, and the hardened test.
MUT_SHIM=$ROOT/shim-m2 $H pr 0 m2-pr "should call monitor tool" & $H hard 0 hard-clean "should call monitor tool" & wait
MUT_SHIM=$ROOT/shim-m2 $H hard 0 hard-m2 "should call monitor tool"
