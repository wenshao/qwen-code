#!/bin/bash
# Round 3 deterministic E2E on Linux, arms interleaved per round.
R=/root/pr13332-rig; O=$R/run-mode.sh
for i in 1 2 3; do
  for a in base head merge; do $O $a-big-r$i $a --big-output; done
  for a in base head merge; do $O $a-sf-r$i $a --session-failover; done
  for a in base head merge; do $O $a-iff-r$i $a --inflight-failover; done
  for a in base head merge; do $O $a-cff-r$i $a --continuation-failover; done
done
echo BATCH_DONE >> $R/runs/RESULTS.txt
