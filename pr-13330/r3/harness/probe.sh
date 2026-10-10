#!/bin/bash
# usage: probe.sh <arm> <Test[#method]> <logname>
arm=$1; t=$2; log=$3; R=/root/pr13330-r3
$R/mvn.sh $arm managed-agent-server 3 8g -Dsurefire.failIfNoSpecifiedTests=false \
  -Dnode.executable=/usr/local/bin/node -Dqwen.cli.entry=$R/cli/dist/cli.js "-Dtest=$t" test > $R/logs/$log.log 2>&1
echo EXIT=$? >> $R/logs/$log.log
