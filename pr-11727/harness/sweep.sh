#!/usr/bin/env bash
# Explicit-threshold sweep for the reservation-starves-preview finding.
# slow = c4 command (long-run advisory fires), fast = c3 command (no advisory).
set -uo pipefail
cd /root/git/h11727
for T in 300 600 700 800 1000 1300 1600 2000 4000; do
  echo "{\"tools\":{\"truncateToolOutputThreshold\":$T}}" > ov-t$T.json
  for arm in base head; do ./run.sh $arm c4-t600-slow-fail sw-$arm-slow-t$T ov-t$T.json; done
done
for T in 600 1000; do
  for arm in base head; do ./run.sh $arm c3-t100-fast-fail sw-$arm-fast-t$T ov-t$T.json; done
done
echo SWEEP-DONE
