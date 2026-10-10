#!/bin/bash
R=$(cd $(dirname $0); pwd); jar=$1; db=$2
LANE=1 $R/stop-l.sh > /dev/null
LANE=1 DB=$db ROOTS=$R/roots-F $R/up-l.sh $jar $HOME/git/qwen-code-pr13654 | tail -1
f=$(ls -t $R/run/spring-lane1-$db-*.log | head -1)
grep -o "Schema \`$db\` is up to date[^\n]\{0,40\}\|Successfully applied [0-9]* migration[^\n]\{0,80\}\|Started ManagedAgentServerApplication in [0-9.]* seconds" $f | head -3
