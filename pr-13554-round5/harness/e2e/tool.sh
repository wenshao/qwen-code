#!/bin/bash
# usage: DB=<db> [ARM=head] tool.sh <args...>
E=/Users/wenshao/pr13554-rig/e2e
exec java -Ddb=$DB -Ddbhost=${DBHOST:-mysql84:3306} -cp $E/classes-${ARM:-head}:$E/app-${ARM:-head}/classes:$(cat $E/cp-${ARM:-head}.txt) com.alibaba.qwen.code.managedagent.store.E2ETool "$@" 2>&1 | grep -v "^SLF4J\|DEBUG\|Commons"
