#!/bin/bash
# macOS host: repeat the unmodified Hosted session test file N times in a tree. usage: flake.sh <tree> <label> <n>
RIG=/rig; cd $RIG/$1/packages/cli
for i in $(seq 1 $3); do
  npx vitest run src/serve/hosted-harness-session.test.ts --coverage.enabled=false > /tmp/rig/flake-$2-$i.log 2>&1; rc=$?
  echo "[$2] run $i: exit=$rc $(grep -E '^ +Tests ' /tmp/rig/flake-$2-$i.log | tr -s ' ') load=$(sysctl -n vm.loadavg | cut -d' ' -f2) $(grep -E '^ (FAIL|×) |^   × ' /tmp/rig/flake-$2-$i.log | sed 's/src\/serve\/hosted-harness-session.test.ts > //' | cut -c1-140 | sort -u | tr '\n' ';')"
done
