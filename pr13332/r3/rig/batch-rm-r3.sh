#!/bin/bash
R=/Users/wenshao/git/pr13332-rig
for i in 1 2 3; do for a in head merge; do $R/run-e2e-r3.sh $a-rm-r$i $a --model qwen3.8-max; done; done
echo BATCH_RM_R3_DONE
