#!/bin/bash
# usage: stress.sh <runs> <arm...>
R=/Users/wenshao/pr13214-rig; J=/Users/wenshao/Install/jdk21/bin/java; runs=$1; shift
for arm in "$@"; do
  start=$(date +%s)
  $J -cp "$R/classes-stress:$(cat $R/cp-$arm.txt)" com.alibaba.qwen.code.runtimebroker.StressRepeat $runs > $R/logs/stress-$arm-$(date +%s).log 2>&1
  echo "$arm $(grep -h RESULT $(ls -t $R/logs/stress-$arm-*.log | head -1)) secs=$(( $(date +%s) - start )) load=$(uptime | awk -F'averages: ' '{print $2}')" >> $R/logs/stress.status
done
