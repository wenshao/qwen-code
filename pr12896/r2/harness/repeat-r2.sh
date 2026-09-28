#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/5b0e58b6-6b84-4099-862a-65878f027ec4/scratchpad
for i in 1 2 3 4; do
  for db in mysql mariadb; do
    L0=$(uptime | sed 's/.*averages: //' | cut -d' ' -f1)
    M2=$SP/m2-r2 $SP/rig/it2.sh r2rep-$db-$i $db hosted-process-crashes verify -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false > /dev/null 2>&1
    rc=$?
    L=$SP/logs/it-r2rep-$db-$i.log
    t=$(grep -o "Time elapsed: [0-9.]* s -- in com.alibaba.qwen.code.managedagent.HostedProcessCrashIT" $L | grep -o "[0-9.]* s")
    echo "r2rep $db $i exit=$rc class=$t ok=$(grep -c '^HOSTED_PROCESS_CRASH_OK' $L) transcript503=$(grep -c 'live transcript unavailable' $L) load=$L0 why=$(node $SP/rig/why.cjs $L | cut -c1-120)" | tee -a $SP/results/repeats-r2.txt
  done
done
echo R2_REPEATS_DONE
