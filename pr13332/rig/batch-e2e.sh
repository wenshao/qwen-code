#!/bin/bash
R=/Users/wenshao/git/pr13332-rig
O=$R/run-e2e.sh
M=qwen3.8-max
for i in 2 3; do $O head-sf-r$i head --session-failover; done
for i in 1 2 3; do $O base-sf-r$i base --session-failover; done
for i in 1 2 3; do $O merge-sf-r$i merge --session-failover; done
for i in 1 2 3; do $O head-rm-r$i head --model $M; done
for i in 1 2 3; do $O merge-rm-r$i merge --model $M; done
for i in 1 2; do $O base-rm-r$i base --model $M; done
echo BATCH_E2E_DONE
