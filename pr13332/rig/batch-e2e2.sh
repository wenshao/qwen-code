#!/bin/bash
# Second real-model batch: started after batch-e2e.sh finishes (serial).
R=/Users/wenshao/git/pr13332-rig
while kill -0 11407 2>/dev/null; do sleep 5; done
O=$R/run-e2e.sh
M=qwen3.8-max
for i in 4 5 6 7; do $O head-rm-r$i head --model $M; done
for i in 3 4 5 6; do $O base-rm-r$i base --model $M; done
for i in 4 5; do $O merge-rm-r$i merge --model $M; done
echo BATCH_E2E2_DONE
