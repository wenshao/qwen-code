#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/5b0e58b6-6b84-4099-862a-65878f027ec4/scratchpad
for i in 1 2 3; do
  for db in mysql mariadb; do
    $SP/rig/it.sh rep-$db-$i $db hosted-process-crashes verify -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false > /dev/null 2>&1
    rc=$?
    t=$(grep -o "Time elapsed: [0-9.]* s -- in com.alibaba.qwen.code.managedagent.HostedProcessCrashIT" $SP/logs/it-rep-$db-$i.log | grep -o "[0-9.]* s")
    ok=$(grep -c "^HOSTED_PROCESS_CRASH_OK" $SP/logs/it-rep-$db-$i.log)
    echo "rep $db $i exit=$rc class=$t ok=$ok load=$(uptime | sed 's/.*averages: //')" | tee -a $SP/results/repeats.txt
  done
done
