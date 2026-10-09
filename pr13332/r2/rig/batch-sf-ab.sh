#!/bin/bash
# Interleaved head/base --session-failover A/B, after the r2 batch (pid 1572).
R=/Users/wenshao/git/pr13332-rig
while kill -0 1572 2>/dev/null; do sleep 5; done
O=$R/run-e2e-r2.sh
for i in 4 5 6 7 8; do $O head-sf-r$i head --session-failover; $O base-sf-r$i base --session-failover; done
echo BATCH_SF_AB_DONE
