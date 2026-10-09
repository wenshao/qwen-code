#!/bin/bash
R=/Users/wenshao/git/pr13332-rig
O=$R/run-e2e-r2.sh
M=qwen3.8-max
for i in 9 10 11 12 13 14; do $O head-sf-r$i head --session-failover; $O base-sf-r$i base --session-failover; done
for i in 6 7 8 9; do $O head-rm-r$i head --model $M; done
for i in 4 5; do $O base-rm-r$i base --model $M; done
echo BATCH_R2B_DONE
