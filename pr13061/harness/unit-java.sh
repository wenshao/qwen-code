#!/bin/bash
# usage: unit-java.sh <mutant>... -- run the module's unit tests with each mutant applied in wt-unit
source <rig>/rig/env.sh
for M in "$@"; do
  KIND=$(node $SP/rig/mutants.cjs kind $M)
  case $KIND in broker) MOD=runtime-broker;; server) MOD=managed-agent-server;; *) continue;; esac
  node $SP/rig/mutants.cjs apply $M wt-unit > /dev/null || continue
  (cd $SP/wt-unit && mvn --batch-mode --no-transfer-progress -o -Dmaven.repo.local=$SP/m2 -f packages/sdk-java/$MOD/pom.xml test -Dsurefire.failIfNoSpecifiedTests=false > $SP/logs/unit-java-$M.log 2>&1)
  RC=$?
  node $SP/rig/mutants.cjs restore $M wt-unit > /dev/null
  SUM=$(grep -E "Tests run:.*Skipped: [0-9]+$" $SP/logs/unit-java-$M.log | tail -1 | sed 's/.*Tests run/Tests run/')
  FAILED=$(grep -E "<<< (FAILURE|ERROR)!" $SP/logs/unit-java-$M.log | grep -v "Tests run" | sed -E 's/^\[ERROR\] //; s/ -- Time.*//' | sort -u | head -4 | tr '\n' ';' | cut -c1-300)
  COMPILE=$(grep -c "COMPILATION ERROR" $SP/logs/unit-java-$M.log)
  echo "$M $MOD-unit rc=$RC compileErr=$COMPILE $SUM | $FAILED" | tee -a $SP/results/unit-cross.txt
done
