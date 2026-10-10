#!/bin/bash
# usage: full.sh <arm> [modules...]   full surefire suites, one log per module
arm=$1; shift; R=/root/pr13330-r3
for mod in "${@:-runtime-broker managed-agent-server}"; do
  for m in $mod; do
    $R/mvn.sh $arm $m 3 7g -DargLine=-Xmx4g -Dnode.executable=/usr/local/bin/node -Dqwen.cli.entry=$R/cli/dist/cli.js test > $R/logs/full-$arm-$m.log 2>&1
    echo EXIT=$? >> $R/logs/full-$arm-$m.log
  done
done
