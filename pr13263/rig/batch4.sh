#!/bin/bash
R=/Users/wenshao/git/pr13263-rig
M=qwen3.8-max
for v in m4bobs m4bobs m4obs a2obs a2obs a1obs; do KEEP_TMP=1 $R/run-one.sh $v $v --model $M; done
echo BATCH4_DONE
