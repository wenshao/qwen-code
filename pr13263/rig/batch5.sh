#!/bin/bash
R=/Users/wenshao/git/pr13263-rig
for i in $(seq -w 11 25); do KEEP_TMP=1 $R/run-one.sh obs-qwen38max-rep$i obs --model qwen3.8-max; done
echo BATCH5_DONE
