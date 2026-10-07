#!/bin/bash
# usage: DB=<db> ARM=<pr|base> tool.sh <args...>
E=/root/verify/pr13554/e2e
exec /usr/local/jdk21/bin/java -Ddb=$DB -cp $E/classes-${ARM:-pr}:$E/app-${ARM:-pr}/classes:$(cat $E/cp-wt-${ARM:-pr}.txt) com.alibaba.qwen.code.managedagent.store.E2ETool "$@" 2>&1 | grep -v "^SLF4J\|DEBUG"
