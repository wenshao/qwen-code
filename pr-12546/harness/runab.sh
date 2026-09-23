#!/bin/bash
# runab.sh <arm> <task> <rep>
R=/root/verify/pr12546-rig; arm=$1; task=$2; rep=$3
d=$R/runs/$task/$arm-$rep; rm -rf $d; mkdir -p $d; if [ "$task" = deleg ] || [ "$task" = deleg2 ]; then cp -r $R/bigfix $d/ws; else cp -r $R/fixture $d/ws; fi
prompt=$(cat $R/tasks/$task.txt)
cd $d/ws && QWEN_HOME=$R/qhome-$arm QWEN_CODE_SUPPRESS_YOLO_WARNING=1 timeout 600 node /root/verify/pr12546-$arm/dist/cli.js --prompt "$prompt" --yolo -o stream-json > $d/out.jsonl 2> $d/err.log
echo "EXIT=$?" > $d/exit
