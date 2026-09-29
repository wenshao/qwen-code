#!/bin/bash
source <rig>/rig/env.sh
# A: Broker fault-gates profile (as in CI) with J5, wt-unit + m2
node $SP/rig/mutants.cjs apply J5 wt-unit > /dev/null
(cd $SP/wt-unit && mvn --batch-mode --no-transfer-progress -o -Dmaven.repo.local=$SP/m2 -f packages/sdk-java/runtime-broker/pom.xml -Pfault-gates -Dqwen.cli.entry=$SP/wt-unit/dist/cli.js test > $SP/logs/j5-faultgates.log 2>&1); echo "J5 fault-gates rc=$? $(grep -E 'Tests run:.*Skipped: [0-9]+$' $SP/logs/j5-faultgates.log | tail -1)" >> $SP/results/j5-wide.txt
node $SP/rig/mutants.cjs restore J5 wt-unit > /dev/null
(cd $SP/wt-unit && mvn --batch-mode --no-transfer-progress -o -Dmaven.repo.local=$SP/m2 -f packages/sdk-java/runtime-broker/pom.xml -Pfault-gates -Dqwen.cli.entry=$SP/wt-unit/dist/cli.js test > $SP/logs/base-faultgates.log 2>&1); echo "BASE fault-gates rc=$? $(grep -E 'Tests run:.*Skipped: [0-9]+$' $SP/logs/base-faultgates.log | tail -1)" >> $SP/results/j5-wide.txt
echo J5A_DONE >> $SP/results/j5-wide.txt
