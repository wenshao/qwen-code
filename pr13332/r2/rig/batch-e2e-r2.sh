#!/bin/bash
R=/Users/wenshao/git/pr13332-rig
O=$R/run-e2e-r2.sh
M=qwen3.8-max
for a in head base merge; do for i in 1 2 3; do $O $a-sf-r$i $a --session-failover; done; done
for i in 1 2 3 4 5; do $O head-rm-r$i head --model $M; $O merge-rm-r$i merge --model $M; done
for i in 1 2 3; do $O base-rm-r$i base --model $M; done
echo BATCH_E2E_R2_DONE
