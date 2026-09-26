#!/bin/bash
# Interleaved repeat of ManagedAgentServerIntegrationTest: PR head vs main base.
OUT=<scratchpad>/logs/flake.tsv; : > $OUT
for i in $(seq 1 20); do
  for arm in pr base; do
    if [ $arm = pr ]; then D=$HOME/git/qwen-code-pr12754-h3/packages/sdk-java/managed-agent-server; M=<scratchpad>/mvn21-h2; else D=<scratchpad>/base3-src/packages/sdk-java/managed-agent-server; M=<scratchpad>/mvn21-base3; fi
    L=<scratchpad>/logs/flake-$arm-$i.log
    (cd $D && $M test -Dtest=ManagedAgentServerIntegrationTest -Dsurefire.rerunFailingTestsCount=0 > $L 2>&1)
    R=$(grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$" $L | tail -1 | sed 's/.*Tests run/Tests run/')
    F=$(grep -o "ManagedAgentServerIntegrationTest\.[A-Za-z]* -- Time elapsed.*FAILURE" $L | sed 's/ -- .*//' | tr '\n' ' ')
    echo -e "$i\t$arm\t$R\t$F" >> $OUT
  done
done
echo DONE >> $OUT
