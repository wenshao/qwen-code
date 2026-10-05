#!/bin/bash
cd /root/verify/pr13296
CP=$(cat cp-pr.txt)
run() { ./jrun.sh java -cp harness/out:arms/$1-classes:$CP -Dout.dir=results -Dobjects.root=/root/verify/pr13296/objstore \
    com.alibaba.qwen.code.managedagent.store.BackoffHarness $1 $2 > logs/harness-$2-$1.log 2>&1; echo "$2 $1 exit $?" >> logs/harness-CD.status; }
run pr D
run base C
run pr C
