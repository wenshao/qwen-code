#!/bin/bash
cd /root/verify/pr13296
CP=$(cat cp-pr.txt)
for arm in base pr; do
  ./jrun.sh java -cp harness/out:arms/$arm-classes:$CP -Dout.dir=results -Dobjects.root=/root/verify/pr13296/objstore \
    com.alibaba.qwen.code.managedagent.store.BackoffHarness $arm A > logs/harness-A-$arm.log 2>&1
  echo "arm $arm exit $?" >> logs/harness-A.status
done
